import { useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { QRCodeSVG } from 'qrcode.react';

const socket = io('/', { path: '/socket.io' });
const CANVAS_SIZE = 500;
const PADDLE_WIDTH = 80;
const PADDLE_HEIGHT = 14;
const BALL_RADIUS = 7;
const AI_Y = 24;
const AI_MAX_SPEED = 3.2;
const MAX_TILT_DEG = 25;
const DEADZONE_DEG = 4;
const SMOOTHING = 0.2;

function generateRoomCode() {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

function isMobileDevice() {
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeTilt(value) {
  return clamp(value / MAX_TILT_DEG, -1, 1);
}

function applyDeadzone(value, deadzoneRatio) {
  if (Math.abs(value) < deadzoneRatio) return 0;
  const sign = Math.sign(value);
  const scaled = (Math.abs(value) - deadzoneRatio) / (1 - deadzoneRatio);
  return sign * clamp(scaled, 0, 1);
}

function App() {
  const [roomCode, setRoomCode] = useState('');
  const [connected, setConnected] = useState(false);
  const [controllerReady, setControllerReady] = useState(false);
  const [status, setStatus] = useState('Tap to connect');
  const [copied, setCopied] = useState(false);
  const [score, setScore] = useState({ player: 0, ai: 0 });
  const [controllerLinked, setControllerLinked] = useState(false);
  const [sensitivity, setSensitivity] = useState(1.2);
  const [paddlePos, setPaddlePos] = useState({
    x: CANVAS_SIZE / 2 - PADDLE_WIDTH / 2,
    y: CANVAS_SIZE - 42,
  });
  const canvasRef = useRef(null);
  const sendIntervalRef = useRef(null);
  const orientationHandlerRef = useRef(null);
  const latestGyroRef = useRef({ alpha: 0, beta: 0, gamma: 0 });
  const animationFrameRef = useRef(null);
  const playerPaddleRef = useRef({
    x: CANVAS_SIZE / 2 - PADDLE_WIDTH / 2,
    y: CANVAS_SIZE - 42,
    width: PADDLE_WIDTH,
    height: PADDLE_HEIGHT,
  });
  const aiPaddleRef = useRef({
    x: CANVAS_SIZE / 2 - PADDLE_WIDTH / 2,
    y: AI_Y,
    width: PADDLE_WIDTH,
    height: PADDLE_HEIGHT,
  });
  const ballRef = useRef({
    x: CANVAS_SIZE / 2,
    y: CANVAS_SIZE / 2,
    vx: 1.8,
    vy: 1.8,
    radius: BALL_RADIUS,
  });
  const servePauseUntilRef = useRef(0);
  const controlRef = useRef({
    baselineBeta: null,
    baselineGamma: null,
    smoothX: 0,
    smoothY: 0,
  });

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
    const onGyroData = ({ beta, gamma }) => {
      setControllerLinked(true);
      if (controlRef.current.baselineBeta === null || controlRef.current.baselineGamma === null) {
        controlRef.current.baselineBeta = beta ?? 0;
        controlRef.current.baselineGamma = gamma ?? 0;
      }

      const relativeBeta = (beta ?? 0) - controlRef.current.baselineBeta;
      const relativeGamma = (gamma ?? 0) - controlRef.current.baselineGamma;
      const deadzoneRatio = DEADZONE_DEG / MAX_TILT_DEG;

      const targetX = applyDeadzone(normalizeTilt(relativeGamma), deadzoneRatio);
      const targetY = applyDeadzone(normalizeTilt(relativeBeta), deadzoneRatio);

      controlRef.current.smoothX += (targetX - controlRef.current.smoothX) * SMOOTHING;
      controlRef.current.smoothY += (targetY - controlRef.current.smoothY) * SMOOTHING;

      const speed = 9 * sensitivity;
      setPaddlePos((prev) => ({
        x: clamp(prev.x + controlRef.current.smoothX * speed, 0, CANVAS_SIZE - PADDLE_WIDTH),
        y: clamp(prev.y + controlRef.current.smoothY * speed, AI_Y + 24, CANVAS_SIZE - 20),
      }));
    };

    socket.on('gyro_data', onGyroData);
    return () => socket.off('gyro_data', onGyroData);
  }, [mobileView, roomCode, sensitivity]);

  useEffect(() => {
    playerPaddleRef.current = {
      ...playerPaddleRef.current,
      x: paddlePos.x,
      y: paddlePos.y,
    };
  }, [paddlePos]);

  useEffect(() => {
    if (mobileView || !canvasRef.current) return;
    const ctx = canvasRef.current.getContext('2d');

    const resetBall = (serveDirection) => {
      const baseSpeed = 1.8;
      const randomX = (Math.random() - 0.5) * 1.1;
      ballRef.current = {
        ...ballRef.current,
        x: CANVAS_SIZE / 2,
        y: CANVAS_SIZE / 2,
        vx: randomX,
        vy: serveDirection * baseSpeed,
      };
      servePauseUntilRef.current = performance.now() + 1000;
    };

    const bounceOnPaddle = (paddle, movingDown) => {
      const ball = ballRef.current;
      const withinX = ball.x + ball.radius >= paddle.x && ball.x - ball.radius <= paddle.x + paddle.width;
      const withinY = ball.y + ball.radius >= paddle.y && ball.y - ball.radius <= paddle.y + paddle.height;
      if (!withinX || !withinY) return false;
      if (movingDown && ball.vy < 0) return false;
      if (!movingDown && ball.vy > 0) return false;

      const hitOffset = (ball.x - (paddle.x + paddle.width / 2)) / (paddle.width / 2);
      ball.vx += hitOffset * 1.2;
      ball.vx = clamp(ball.vx, -4.2, 4.2);
      ball.vy = movingDown ? -Math.abs(ball.vy) : Math.abs(ball.vy);
      ball.y = movingDown ? paddle.y - ball.radius : paddle.y + paddle.height + ball.radius;
      return true;
    };

    const renderFrame = () => {
      const now = performance.now();
      const ball = ballRef.current;
      const player = playerPaddleRef.current;
      const ai = aiPaddleRef.current;

      const aiTargetX = clamp(ball.x - ai.width / 2, 0, CANVAS_SIZE - ai.width);
      const aiDelta = clamp(aiTargetX - ai.x, -AI_MAX_SPEED, AI_MAX_SPEED);
      ai.x += aiDelta;

      if (now >= servePauseUntilRef.current) {
        ball.x += ball.vx;
        ball.y += ball.vy;

        if (ball.x - ball.radius <= 0) {
          ball.x = ball.radius;
          ball.vx *= -1;
        }
        if (ball.x + ball.radius >= CANVAS_SIZE) {
          ball.x = CANVAS_SIZE - ball.radius;
          ball.vx *= -1;
        }

        bounceOnPaddle(player, true);
        bounceOnPaddle(ai, false);

        if (ball.y - ball.radius <= 0) {
          setScore((prev) => ({ ...prev, player: prev.player + 1 }));
          resetBall(1);
        } else if (ball.y + ball.radius >= CANVAS_SIZE) {
          setScore((prev) => ({ ...prev, ai: prev.ai + 1 }));
          resetBall(-1);
        }
      }

      ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 2;
      ctx.strokeRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

      ctx.fillStyle = '#f59e0b';
      ctx.fillRect(ai.x, ai.y, ai.width, ai.height);
      ctx.fillStyle = '#38bdf8';
      ctx.fillRect(player.x, player.y, player.width, player.height);

      ctx.beginPath();
      ctx.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2);
      ctx.fillStyle = '#f8fafc';
      ctx.fill();

      if (now < servePauseUntilRef.current) {
        ctx.fillStyle = '#cbd5e1';
        ctx.font = '600 16px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Serve in 1...', CANVAS_SIZE / 2, CANVAS_SIZE / 2 + 32);
      }

      animationFrameRef.current = window.requestAnimationFrame(renderFrame);
    };

    resetBall(Math.random() > 0.5 ? 1 : -1);
    animationFrameRef.current = window.requestAnimationFrame(renderFrame);

    return () => {
      if (animationFrameRef.current) {
        window.cancelAnimationFrame(animationFrameRef.current);
      }
    };
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
        <p className="score">Player {score.player} : {score.ai} AI</p>
        <div className="sensitivity-wrap">
          <label htmlFor="sensitivity">Sensitivity {sensitivity.toFixed(1)}x</label>
          <input
            id="sensitivity"
            type="range"
            min="0.6"
            max="2"
            step="0.1"
            value={sensitivity}
            onChange={(event) => setSensitivity(Number(event.target.value))}
          />
        </div>
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
        <canvas ref={canvasRef} width={CANVAS_SIZE} height={CANVAS_SIZE} />
      </section>
    </main>
  );
}

export default App;
