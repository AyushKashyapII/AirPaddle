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
const PADDLE_RADIUS = 0.52;
const PADDLE_THICKNESS = 0.18;
const PADDLE_TABLE_CLEARANCE = 0.26;
const PADDLE_Y_MIN = TABLE_TOP_Y + PADDLE_RADIUS + PADDLE_TABLE_CLEARANCE;
const PADDLE_BASE_Y = PADDLE_Y_MIN + 0.12;
const PADDLE_X_MIN = -2;
const PADDLE_X_MAX = 2;
const PADDLE_Y_MAX = 3.2;
const NET_HEIGHT = 0.16;
const NET_THICKNESS = 0.06;
const ORIENTATION_SMOOTHING = 10;
const POSITION_SMOOTHING = 20;
const CONTROLLER_SEND_INTERVAL_MS = 16;
const PADDLE_NEUTRAL_ROTATION = {
  x: Math.PI / 2,
  y: 0,
  z: 0,
};
const PHONE_DEADZONE_DEG = 1.2;
const PITCH_SENSITIVITY = 0.018;
const YAW_SENSITIVITY = 0.011;
const ROLL_SENSITIVITY = 0.015;
const PADDLE_LIMITS = {
  pitch: 0.52,
  yaw: 0.42,
  roll: 0.5,
};
 
function generateRoomCode() {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

function isMobileDevice() {
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function angleDeltaDegrees(current, baseline) {
  return ((((current - baseline) % 360) + 540) % 360) - 180;
}

function applyDeadzone(value, deadzone) {
  if (Math.abs(value) <= deadzone) return 0;
  return value > 0 ? value - deadzone : value + deadzone;
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
    args: [TABLE_WIDTH, NET_HEIGHT, NET_THICKNESS],
    position: [0, TABLE_TOP_Y + NET_HEIGHT / 2, 0],
    type: 'Static',
    material: {
      restitution: 0.4,
      friction: 0.25,
    },
  }));

  return (
    <mesh ref={ref} castShadow receiveShadow>
      <boxGeometry args={[TABLE_WIDTH, NET_HEIGHT, NET_THICKNESS]} />
      <meshStandardMaterial color="#cbd5e1" transparent opacity={0.5} />
    </mesh>
  );
}

function Bounds() {
  useBox(() => ({ args: [0.2, 1.5, TABLE_LENGTH], position: [-TABLE_WIDTH / 2 - 0.1, 0.7, 0], type: 'Static' }));
  useBox(() => ({ args: [0.2, 1.5, TABLE_LENGTH], position: [TABLE_WIDTH / 2 + 0.1, 0.7, 0], type: 'Static' }));
  return null;
}

function PlayerPaddle({ gyroRef, targetPositionRef, calibrated }) {
  const { scene } = useGLTF('/paddle.glb');
  const paddleModel = useMemo(() => scene.clone(true), [scene]);
  const [ref, api] = useCylinder(() => ({
    type: 'Kinematic',
    args: [PADDLE_RADIUS, PADDLE_RADIUS, PADDLE_THICKNESS, 28],
    position: [0, PADDLE_BASE_Y, 5.8],
  }));
  const qTargetRef = useRef(new THREE.Quaternion());
  const qSmoothedRef = useRef(
    new THREE.Quaternion().setFromEuler(
      new THREE.Euler(PADDLE_NEUTRAL_ROTATION.x, PADDLE_NEUTRAL_ROTATION.y, PADDLE_NEUTRAL_ROTATION.z, 'YXZ'),
    ),
  );
  const eulerTargetRef = useRef(new THREE.Euler());
  const eulerSmoothedRef = useRef(new THREE.Euler());
  const smoothedPositionRef = useRef({ x: 0, y: PADDLE_BASE_Y });

  useFrame((_, delta) => {
    const gyro = gyroRef.current;
    const targetPosition = calibrated ? targetPositionRef.current : { x: 0, y: PADDLE_BASE_Y };
    const live = gyro.live;
    const baseline = gyro.baseline;

    const pitchDelta = calibrated
      ? applyDeadzone(angleDeltaDegrees(live.beta || 0, baseline.beta || 0), PHONE_DEADZONE_DEG)
      : 0;
    const yawDelta = calibrated
      ? applyDeadzone(angleDeltaDegrees(live.alpha || 0, baseline.alpha || 0), PHONE_DEADZONE_DEG)
      : 0;
    const rollDelta = calibrated
      ? applyDeadzone(angleDeltaDegrees(live.gamma || 0, baseline.gamma || 0), PHONE_DEADZONE_DEG)
      : 0;

    eulerTargetRef.current.set(
      PADDLE_NEUTRAL_ROTATION.x + clamp(pitchDelta * PITCH_SENSITIVITY, -PADDLE_LIMITS.pitch, PADDLE_LIMITS.pitch),
      PADDLE_NEUTRAL_ROTATION.y + clamp(yawDelta * YAW_SENSITIVITY, -PADDLE_LIMITS.yaw, PADDLE_LIMITS.yaw),
      PADDLE_NEUTRAL_ROTATION.z + clamp(-rollDelta * ROLL_SENSITIVITY, -PADDLE_LIMITS.roll, PADDLE_LIMITS.roll),
      'YXZ',
    );
    qTargetRef.current.setFromEuler(eulerTargetRef.current);
    qSmoothedRef.current.slerp(qTargetRef.current, 1 - Math.exp(-ORIENTATION_SMOOTHING * delta));
    eulerSmoothedRef.current.setFromQuaternion(qSmoothedRef.current, 'YXZ');

    const xPos = clamp(targetPosition.x, PADDLE_X_MIN, PADDLE_X_MAX);
    const yPos = clamp(targetPosition.y, PADDLE_Y_MIN, PADDLE_Y_MAX);
    smoothedPositionRef.current.x = THREE.MathUtils.damp(smoothedPositionRef.current.x, xPos, POSITION_SMOOTHING, delta);
    smoothedPositionRef.current.y = THREE.MathUtils.damp(smoothedPositionRef.current.y, yPos, POSITION_SMOOTHING, delta);
    api.position.set(smoothedPositionRef.current.x, smoothedPositionRef.current.y, 5.8);
    api.rotation.set(eulerSmoothedRef.current.x, eulerSmoothedRef.current.y, eulerSmoothedRef.current.z);
  });

  return (
    <group ref={ref}>
      <group>
        <primitive object={paddleModel} scale={0.38} position={[0, 0.28, -0.2]} />
      </group>
    </group>
  );
}

function OpponentPaddle({ ballPositionRef }) {
  const { scene } = useGLTF('/paddle.glb');
  const paddleModel = useMemo(() => scene.clone(true), [scene]);
  const [ref, api] = useCylinder(() => ({
    type: 'Kinematic',
    args: [PADDLE_RADIUS, PADDLE_RADIUS, PADDLE_THICKNESS, 28],
    position: [0, PADDLE_BASE_Y, -5.8],
  }));
  const opponentXRef = useRef(0);

  useFrame(() => {
    const targetX = clamp(ballPositionRef.current[0], -TABLE_WIDTH / 2 + 0.8, TABLE_WIDTH / 2 - 0.8);
    const maxStep = 0.08;
    const dx = clamp(targetX - opponentXRef.current, -maxStep, maxStep);
    opponentXRef.current += dx;
    api.position.set(opponentXRef.current, PADDLE_BASE_Y, -5.8);
    api.rotation.set(Math.PI / 2, 0, 0);
  });

  return (
    <group ref={ref}>
      <group>
        <primitive object={paddleModel} scale={0.38} position={[0, 0.28, -0.2]} />
      </group>
    </group>
  );
}

function Ball({ ballPositionRef, serveSignal }) {
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

  const serve = () => {
    api.position.set(0, TABLE_TOP_Y + 0.22, -5.8);
    api.velocity.set((Math.random() - 0.5) * 0.6, 3.2, 9.2);
    api.angularVelocity.set(0, 0, 0);
  };

  useEffect(() => {
    serve();
    const timer = window.setInterval(() => {
      const [, y, z] = ballPos.current;
      if (y < -3 || z > 11 || z < -11) {
        serve();
      }
    }, 120);
    return () => window.clearInterval(timer);
  }, [api]);

  useEffect(() => {
    if (serveSignal > 0) {
      serve();
    }
  }, [serveSignal]);

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

function CalibrationGuide({ visible }) {
  if (!visible) return null;

  return (
    <group position={[0, PADDLE_BASE_Y, 5.8]}>
      <mesh>
        <sphereGeometry args={[0.95, 32, 16]} />
        <meshBasicMaterial color="#38bdf8" wireframe transparent opacity={0.34} depthWrite={false} />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.95, 0.012, 12, 96]} />
        <meshBasicMaterial color="#22c55e" transparent opacity={0.8} depthWrite={false} />
      </mesh>
      <mesh rotation={[0, Math.PI / 2, 0]}>
        <torusGeometry args={[0.95, 0.012, 12, 96]} />
        <meshBasicMaterial color="#f97316" transparent opacity={0.8} depthWrite={false} />
      </mesh>
      <mesh rotation={[0, 0, Math.PI / 2]}>
        <torusGeometry args={[0.95, 0.012, 12, 96]} />
        <meshBasicMaterial color="#e879f9" transparent opacity={0.8} depthWrite={false} />
      </mesh>
      <mesh position={[0, 0.95, 0]}>
        <coneGeometry args={[0.08, 0.22, 18]} />
        <meshBasicMaterial color="#f8fafc" />
      </mesh>
      <mesh position={[0, 0.46, 0]}>
        <cylinderGeometry args={[0.025, 0.025, 0.92, 12]} />
        <meshBasicMaterial color="#f8fafc" />
      </mesh>
    </group>
  );
}

function DesktopScene({ gyroRef, targetPositionRef, serveSignal, controllerLinked, calibrated }) {
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
          <PlayerPaddle gyroRef={gyroRef} targetPositionRef={targetPositionRef} calibrated={calibrated} />
          <OpponentPaddle ballPositionRef={ballPositionRef} />
          <Ball ballPositionRef={ballPositionRef} serveSignal={serveSignal} />
        </Physics>
        <CalibrationGuide visible={controllerLinked && !calibrated} />
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
  const [calibrated, setCalibrated] = useState(false);
  const gyroRef = useRef({
    live: { alpha: 0, beta: 0, gamma: 0 },
    baseline: { alpha: 0, beta: 0, gamma: 0 },
  });
  const paddleTargetRef = useRef({ x: 0, y: PADDLE_BASE_Y });
  const [serveSignal, setServeSignal] = useState(0);
  const [calibratedFlash, setCalibratedFlash] = useState(false);
  const sendFrameRef = useRef(null);
  const lastSendAtRef = useRef(0);
  const orientationHandlerRef = useRef(null);
  const latestGyroRef = useRef({ alpha: 0, beta: 0, gamma: 0 });
  const calibrationOffsetRef = useRef({ alpha: 0, beta: 0, gamma: 0 });
  const calibratedRef = useRef(false);
  const trackpadTouchRef = useRef(null);
  const controllerLinkedRef = useRef(false);

  const urlRoom = useMemo(() => new URLSearchParams(window.location.search).get('room') || '', []);
  const mobileView = useMemo(() => Boolean(urlRoom) || isMobileDevice(), [urlRoom]);

  const joinRoom = (targetRoom) => {
    socket.emit('join_room', { roomCode: targetRoom });
  };

  const markControllerLinked = () => {
    if (controllerLinkedRef.current) return;
    controllerLinkedRef.current = true;
    setControllerLinked(true);
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
    calibratedRef.current = false;
    setCalibrated(false);
    joinRoom(roomCode);
    const onGyroData = ({ alpha, beta, gamma }) => {
      markControllerLinked();
      gyroRef.current = {
        live: {
          alpha: alpha ?? 0,
          beta: beta ?? 0,
          gamma: gamma ?? 0,
        },
        baseline: calibrationOffsetRef.current,
      };
    };
    const onCalibrationOffset = ({ alpha, beta, gamma }) => {
      calibrationOffsetRef.current = {
        alpha: alpha ?? 0,
        beta: beta ?? 0,
        gamma: gamma ?? 0,
      };
      gyroRef.current = {
        ...gyroRef.current,
        baseline: calibrationOffsetRef.current,
      };
      paddleTargetRef.current = { x: 0, y: PADDLE_BASE_Y };
      calibratedRef.current = true;
      setCalibrated(true);
      setCalibratedFlash(true);
      window.setTimeout(() => setCalibratedFlash(false), 1000);
    };
    const onPaddleMove = ({ dx = 0, dy = 0 }) => {
      markControllerLinked();
      if (!calibratedRef.current) return;
      const moveScale = 0.01;
      paddleTargetRef.current = {
        x: clamp(paddleTargetRef.current.x + dx * moveScale, PADDLE_X_MIN, PADDLE_X_MAX),
        y: clamp(paddleTargetRef.current.y - dy * moveScale, PADDLE_Y_MIN, PADDLE_Y_MAX),
      };
    };

    socket.on('gyro_data', onGyroData);
    socket.on('calibration_offset', onCalibrationOffset);
    socket.on('paddle_move', onPaddleMove);
    return () => {
      socket.off('gyro_data', onGyroData);
      socket.off('calibration_offset', onCalibrationOffset);
      socket.off('paddle_move', onPaddleMove);
    };
  }, [mobileView, roomCode]);

  useEffect(() => {
    if (mobileView) return;
    const onKeyDown = (event) => {
      if (event.code === 'Space') {
        event.preventDefault();
        setServeSignal((prev) => prev + 1);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [mobileView]);

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
      setStatus('Controller connected. Hold a comfortable ready pose, then set neutral.');
      setControllerReady(true);

      if (sendFrameRef.current) {
        window.cancelAnimationFrame(sendFrameRef.current);
        sendFrameRef.current = null;
      }
      if (orientationHandlerRef.current) {
        window.removeEventListener('deviceorientation', orientationHandlerRef.current, true);
        orientationHandlerRef.current = null;
      }
      const onOrientation = (event) => {
        const reading = {
          alpha: event.alpha ?? 0,
          beta: event.beta ?? 0,
          gamma: event.gamma ?? 0,
        };
        latestGyroRef.current = reading;
      };
      orientationHandlerRef.current = onOrientation;

      window.addEventListener('deviceorientation', onOrientation, true);

      const sendGyroFrame = (now) => {
        if (now - lastSendAtRef.current >= CONTROLLER_SEND_INTERVAL_MS) {
          lastSendAtRef.current = now;
          socket.emit('gyro_data', {
            roomCode,
            ...latestGyroRef.current,
            timestamp: Date.now(),
          });
        }
        sendFrameRef.current = window.requestAnimationFrame(sendGyroFrame);
      };
      lastSendAtRef.current = 0;
      sendFrameRef.current = window.requestAnimationFrame(sendGyroFrame);
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
    setStatus('Neutral set. Move from this comfortable pose to control the paddle.');
  };

  const handleTrackpadTouchStart = (event) => {
    const touch = event.touches[0];
    if (!touch) return;
    trackpadTouchRef.current = { x: touch.clientX, y: touch.clientY };
  };

  const handleTrackpadTouchMove = (event) => {
    event.preventDefault();
    const touch = event.touches[0];
    if (!touch || !trackpadTouchRef.current || !roomCode || !controllerReady) return;

    const dx = touch.clientX - trackpadTouchRef.current.x;
    const dy = touch.clientY - trackpadTouchRef.current.y;
    trackpadTouchRef.current = { x: touch.clientX, y: touch.clientY };

    socket.emit('paddle_move', {
      roomCode,
      dx,
      dy,
      timestamp: Date.now(),
    });
  };

  const handleTrackpadTouchEnd = () => {
    trackpadTouchRef.current = null;
  };

  useEffect(() => {
    return () => {
      if (sendFrameRef.current) {
        window.cancelAnimationFrame(sendFrameRef.current);
        sendFrameRef.current = null;
      }
      if (orientationHandlerRef.current) {
        window.removeEventListener('deviceorientation', orientationHandlerRef.current, true);
        orientationHandlerRef.current = null;
      }
    };
  }, []);

  const joinUrl = roomCode ? `${window.location.origin}?room=${roomCode}` : window.location.origin;

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
            Connect Controller
          </button>
          <button className="cta cta-secondary" onClick={calibrateController} disabled={!controllerReady}>
            Set Neutral / Recenter
          </button>
          <div
            className="trackpad"
            onTouchStart={handleTrackpadTouchStart}
            onTouchMove={handleTrackpadTouchMove}
            onTouchEnd={handleTrackpadTouchEnd}
            onTouchCancel={handleTrackpadTouchEnd}
          >
            <span>Thumb Trackpad</span>
          </div>
          <p className="status">{status}</p>
        </section>
      </main>
    );
  }

  return (
    <main className="app desktop">
      <section className={`panel ${controllerLinked ? 'panel-compact' : ''}`}>
        <h1>AirPaddle</h1>
        <p className={`code ${controllerLinked ? 'code-compact' : ''}`}>{roomCode || '----'}</p>
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
        {controllerLinked && !calibrated && <p className="status">Hold your phone naturally, then set neutral.</p>}
        {controllerLinked && calibrated && <p className="status">Controller calibrated</p>}
        {calibratedFlash && <p className="status calibrated">Calibrated!</p>}
        <div className={`scene-wrap ${controllerLinked ? 'scene-wrap-expanded' : ''}`}>
          <DesktopScene
            gyroRef={gyroRef}
            targetPositionRef={paddleTargetRef}
            serveSignal={serveSignal}
            controllerLinked={controllerLinked}
            calibrated={calibrated}
          />
        </div>
      </section>
    </main>
  );
}

useGLTF.preload('/paddle.glb');

export default App;
