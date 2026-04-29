import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { QRCodeSVG } from 'qrcode.react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Environment, OrbitControls, useGLTF } from '@react-three/drei';
import { Physics, useBox, useCylinder, useSphere } from '@react-three/cannon';
import * as THREE from 'three';

const socket = io('/', { path: '/socket.io' });
const TABLE_WIDTH = 8;
const TABLE_LENGTH = 16;
const TABLE_HEIGHT = 0.42;
const TABLE_TOP_Y = TABLE_HEIGHT / 2;

function generateRoomCode() {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

function isMobileDevice() {
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function Table() {
  const [ref] = useBox(() => ({
    args: [TABLE_WIDTH, TABLE_HEIGHT, TABLE_LENGTH],
    position: [0, 0, 0],
    type: 'Static',
  }));
  return (
    <mesh ref={ref} receiveShadow>
      <boxGeometry args={[TABLE_WIDTH, TABLE_HEIGHT, TABLE_LENGTH]} />
      <meshStandardMaterial color="#1f7a3d" />
    </mesh>
  );
}

function Net() {
  const [ref] = useBox(() => ({
    args: [TABLE_WIDTH, 0.6, 0.12],
    position: [0, 0.45, 0],
    type: 'Static',
  }));

  return (
    <mesh ref={ref} castShadow receiveShadow>
      <boxGeometry args={[TABLE_WIDTH, 0.6, 0.12]} />
      <meshStandardMaterial color="#cbd5e1" transparent opacity={0.5} />
    </mesh>
  );
}

function Bounds() {
  useBox(() => ({ args: [0.2, 1.5, TABLE_LENGTH], position: [-TABLE_WIDTH / 2 - 0.1, 0.7, 0], type: 'Static' }));
  useBox(() => ({ args: [0.2, 1.5, TABLE_LENGTH], position: [TABLE_WIDTH / 2 + 0.1, 0.7, 0], type: 'Static' }));
  return null;
}

function PlayerPaddle({ gyro }) {
  const { scene } = useGLTF('/paddle.glb');
  const paddleModel = useMemo(() => scene.clone(true), [scene]);
  const [ref, api] = useCylinder(() => ({
    type: 'Kinematic',
    args: [0.52, 0.52, 0.18, 28],
    position: [0, TABLE_TOP_Y + 0.44, 5.8],
  }));
  const eulerLiveRef = useRef(new THREE.Euler());
  const eulerBaseRef = useRef(new THREE.Euler());
  const qLiveRef = useRef(new THREE.Quaternion());
  const qBaseRef = useRef(new THREE.Quaternion());
  const qRelativeRef = useRef(new THREE.Quaternion());
  const qDefaultRef = useRef(new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0)));
  const qFinalRef = useRef(new THREE.Quaternion());
  const eulerFinalRef = useRef(new THREE.Euler());

  useFrame(() => {
    const live = gyro.live;
    const baseline = gyro.baseline;

    const xTarget = clamp((live.gamma || 0) * 0.06, -TABLE_WIDTH / 2 + 0.8, TABLE_WIDTH / 2 - 0.8);
    const zTarget = clamp(5.8 + (live.beta || 0) * 0.03, 2.2, 7.2);

    eulerLiveRef.current.set(
      THREE.MathUtils.degToRad(live.beta || 0),
      THREE.MathUtils.degToRad(live.alpha || 0),
      THREE.MathUtils.degToRad(-(live.gamma || 0)),
      'YXZ',
    );
    eulerBaseRef.current.set(
      THREE.MathUtils.degToRad(baseline.beta || 0),
      THREE.MathUtils.degToRad(baseline.alpha || 0),
      THREE.MathUtils.degToRad(-(baseline.gamma || 0)),
      'YXZ',
    );

    qLiveRef.current.setFromEuler(eulerLiveRef.current);
    qBaseRef.current.setFromEuler(eulerBaseRef.current);
    qRelativeRef.current.copy(qBaseRef.current).invert().multiply(qLiveRef.current);
    qFinalRef.current.multiplyQuaternions(qDefaultRef.current, qRelativeRef.current);
    eulerFinalRef.current.setFromQuaternion(qFinalRef.current, 'YXZ');

    api.position.set(xTarget, TABLE_TOP_Y + 0.44, zTarget);
    api.rotation.set(eulerFinalRef.current.x, eulerFinalRef.current.y, eulerFinalRef.current.z);
  });

  return (
    <group ref={ref}>
      <group>
        <primitive object={paddleModel} scale={0.38} position={[0, 0.12, -0.26]} />
      </group>
    </group>
  );
}

function OpponentPaddle({ ballPositionRef }) {
  const { scene } = useGLTF('/paddle.glb');
  const paddleModel = useMemo(() => scene.clone(true), [scene]);
  const [ref, api] = useCylinder(() => ({
    type: 'Kinematic',
    args: [0.52, 0.52, 0.18, 28],
    position: [0, TABLE_TOP_Y + 0.44, -5.8],
  }));
  const opponentXRef = useRef(0);

  useFrame(() => {
    const targetX = clamp(ballPositionRef.current[0], -TABLE_WIDTH / 2 + 0.8, TABLE_WIDTH / 2 - 0.8);
    const maxStep = 0.08;
    const dx = clamp(targetX - opponentXRef.current, -maxStep, maxStep);
    opponentXRef.current += dx;
    api.position.set(opponentXRef.current, TABLE_TOP_Y + 0.44, -5.8);
    api.rotation.set(Math.PI / 2, 0, 0);
  });

  return (
    <group ref={ref}>
      <group>
        <primitive object={paddleModel} scale={0.38} position={[0, 0.12, -0.26]} />
      </group>
    </group>
  );
}

function Ball({ ballPositionRef }) {
  const [ref, api] = useSphere(() => ({
    args: [0.05],
    mass: 0.09,
    position: [0, TABLE_TOP_Y + 0.22, -5.8],
    material: {
      restitution: 0.96,
      friction: 0.03,
    },
    linearDamping: 0.03,
    angularDamping: 0.04,
    // Helps reduce tunneling through thin colliders at higher velocity.
    collisionResponse: true,
  }));
  const ballPos = useRef([0, TABLE_TOP_Y + 0.22, -5.8]);

  useEffect(
    () =>
      api.position.subscribe((p) => {
        ballPos.current = p;
        ballPositionRef.current = p;
      }),
    [api.position, ballPositionRef],
  );

  useEffect(() => {
    const serve = () => {
      api.position.set(0, TABLE_TOP_Y + 0.22, -5.8);
      api.velocity.set((Math.random() - 0.5) * 0.8, 1.1, 6.5);
      api.angularVelocity.set(0, 0, 0);
    };
    serve();
    const timer = window.setInterval(() => {
      const [, y, z] = ballPos.current;
      if (y < -3 || z > 11 || z < -11) {
        serve();
      }
    }, 120);
    return () => window.clearInterval(timer);
  }, [api]);

  return (
    <mesh ref={ref} castShadow>
      <sphereGeometry args={[0.05, 32, 32]} />
      <meshStandardMaterial color="white" roughness={0.2} />
    </mesh>
  );
}

function CameraRig() {
  const { camera } = useThree();
  useEffect(() => {
    camera.position.set(0, 4.2, 10.4);
    camera.lookAt(0, 0.5, 0);
  }, [camera]);
  return null;
}

function DesktopScene({ gyro }) {
  const ballPositionRef = useRef([0, 2.2, -5.8]);

  return (
    <Canvas shadows camera={{ fov: 52, near: 0.1, far: 100 }}>
      <color attach="background" args={['#020617']} />
      <ambientLight intensity={0.45} />
      <directionalLight
        position={[5, 10, 5]}
        intensity={1.15}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
      />
      <CameraRig />
      <Suspense fallback={null}>
        <Environment preset="city" />
        <Physics gravity={[0, -9.81, 0]}>
          <Table />
          <Net />
          <Bounds />
          <PlayerPaddle gyro={gyro} />
          <OpponentPaddle ballPositionRef={ballPositionRef} />
          <Ball ballPositionRef={ballPositionRef} />
        </Physics>
      </Suspense>
      <OrbitControls enablePan={false} enableZoom={false} minPolarAngle={0.9} maxPolarAngle={1.25} />
    </Canvas>
  );
}

function App() {
  const [roomCode, setRoomCode] = useState('');
  const [connected, setConnected] = useState(false);
  const [controllerReady, setControllerReady] = useState(false);
  const [status, setStatus] = useState('Tap to connect');
  const [copied, setCopied] = useState(false);
  const [controllerLinked, setControllerLinked] = useState(false);
  const [gyro, setGyro] = useState({
    live: { alpha: 0, beta: 0, gamma: 0 },
    baseline: { alpha: 0, beta: 0, gamma: 0 },
  });
  const [calibratedFlash, setCalibratedFlash] = useState(false);
  const sendIntervalRef = useRef(null);
  const orientationHandlerRef = useRef(null);
  const latestGyroRef = useRef({ alpha: 0, beta: 0, gamma: 0 });
  const calibrationOffsetRef = useRef({ alpha: 0, beta: 0, gamma: 0 });

  const urlRoom = useMemo(() => new URLSearchParams(window.location.search).get('room') || '', []);
  const mobileView = useMemo(() => Boolean(urlRoom) || isMobileDevice(), [urlRoom]);

  const joinRoom = (targetRoom) => {
    socket.emit('join_room', { roomCode: targetRoom });
  };

  useEffect(() => {
    const handleConnect = () => {
      setConnected(true);
      if (!mobileView && !urlRoom) {
        const newRoom = generateRoomCode();
        setRoomCode(newRoom);
        socket.emit('create_room', { roomCode: newRoom });
      }
      if (mobileView && urlRoom) {
        setRoomCode(urlRoom);
      }
    };

    const handleDisconnect = () => {
      setConnected(false);
    };

    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    return () => {
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
    };
  }, [mobileView, urlRoom]);

  useEffect(() => {
    if (mobileView || !roomCode) return;
    joinRoom(roomCode);
    const onGyroData = ({ alpha, beta, gamma }) => {
      setControllerLinked(true);
      setGyro({
        live: {
          alpha: alpha ?? 0,
          beta: beta ?? 0,
          gamma: gamma ?? 0,
        },
        baseline: calibrationOffsetRef.current,
      });
    };
    const onCalibrationOffset = ({ alpha, beta, gamma }) => {
      calibrationOffsetRef.current = {
        alpha: alpha ?? 0,
        beta: beta ?? 0,
        gamma: gamma ?? 0,
      };
      setGyro((prev) => ({
        ...prev,
        baseline: calibrationOffsetRef.current,
      }));
      setCalibratedFlash(true);
      window.setTimeout(() => setCalibratedFlash(false), 1000);
    };

    socket.on('gyro_data', onGyroData);
    socket.on('calibration_offset', onCalibrationOffset);
    return () => {
      socket.off('gyro_data', onGyroData);
      socket.off('calibration_offset', onCalibrationOffset);
    };
  }, [mobileView, roomCode]);

  const requestOrientationPermission = async () => {
    if (!window.isSecureContext) {
      setStatus('Motion access needs HTTPS on phone. Use a secure tunnel URL.');
      return false;
    }

    if (typeof DeviceOrientationEvent === 'undefined') {
      setStatus('Orientation not supported on this device');
      return false;
    }

    if (typeof DeviceOrientationEvent.requestPermission === 'function') {
      const permission = await DeviceOrientationEvent.requestPermission();
      return permission === 'granted';
    }
    return true;
  };

  const startController = async () => {
    try {
      if (!roomCode) {
        setStatus('Missing room code');
        return;
      }
      const granted = await requestOrientationPermission();
      if (!granted) {
        setStatus('Permission denied. Check browser/site motion permissions.');
        return;
      }
      joinRoom(roomCode);
      setStatus('Controller Connected - Tilt to move!');
      setControllerReady(true);

      if (sendIntervalRef.current) {
        window.clearInterval(sendIntervalRef.current);
      }
      if (orientationHandlerRef.current) {
        window.removeEventListener('deviceorientation', orientationHandlerRef.current, true);
      }

      const onOrientation = (event) => {
        latestGyroRef.current = {
          alpha: event.alpha ?? 0,
          beta: event.beta ?? 0,
          gamma: event.gamma ?? 0,
        };
      };
      orientationHandlerRef.current = onOrientation;

      window.addEventListener('deviceorientation', onOrientation, true);

      sendIntervalRef.current = window.setInterval(() => {
        socket.emit('gyro_data', {
          roomCode,
          ...latestGyroRef.current,
          timestamp: Date.now(),
        });
      }, 33);
    } catch {
      setStatus('Could not connect controller');
    }
  };

  const calibrateController = () => {
    if (!roomCode) return;
    const baseline = { ...latestGyroRef.current };
    socket.emit('calibration_offset', {
      roomCode,
      ...baseline,
    });
    setStatus('Calibrated. Current phone angle is now neutral.');
  };

  useEffect(() => {
    return () => {
      if (sendIntervalRef.current) {
        window.clearInterval(sendIntervalRef.current);
      }
      if (orientationHandlerRef.current) {
        window.removeEventListener('deviceorientation', orientationHandlerRef.current, true);
      }
    };
  }, []);

  const joinUrl = `${window.location.origin}?room=${roomCode}`;

  const copyControllerLink = async () => {
    if (!roomCode) return;
    try {
      await navigator.clipboard.writeText(joinUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  };

  if (mobileView) {
    return (
      <main className="app mobile">
        <section className="panel">
          <h1>AirPaddle Controller</h1>
          <p className="room-tag">Room {roomCode || '----'}</p>
          <button className="cta" onClick={startController} disabled={!connected || controllerReady}>
            Connect & Calibrate
          </button>
          <button className="cta cta-secondary" onClick={calibrateController} disabled={!controllerReady}>
            Calibrate / Recenter
          </button>
          <p className="status">{status}</p>
        </section>
      </main>
    );
  }

  return (
    <main className="app desktop">
      <section className="panel">
        <h1>AirPaddle Screen</h1>
        <p className="code">{roomCode || '----'}</p>
        {!controllerLinked && roomCode && (
          <>
            <div className="qr-wrap">
              <QRCodeSVG value={joinUrl} size={180} bgColor="#0f172a" fgColor="#f8fafc" />
            </div>
            <button className="copy-btn" onClick={copyControllerLink}>
              {copied ? 'Copied!' : 'Copy Controller Link'}
            </button>
          </>
        )}
        {controllerLinked && <p className="status">Controller connected</p>}
        {calibratedFlash && <p className="status calibrated">Calibrated!</p>}
        <div className="scene-wrap">
          <DesktopScene gyro={gyro} />
        </div>
      </section>
    </main>
  );
}

useGLTF.preload('/paddle.glb');

export default App;
