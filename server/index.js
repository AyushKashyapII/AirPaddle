import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';

const app = express();
const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

app.use(cors());
app.use(express.json());

app.get('/health', (_, res) => {
  res.json({ ok: true });
});

io.on('connection', (socket) => {
  socket.on('create_room', ({ roomCode }) => {
    if (!roomCode) return;
    socket.join(roomCode);
  });

  socket.on('join_room', ({ roomCode }) => {
    if (!roomCode) return;
    socket.join(roomCode);
  });

  socket.on('gyro_data', ({ roomCode, alpha, beta, gamma, timestamp }) => {
    if (!roomCode) return;
    socket.to(roomCode).emit('gyro_data', {
      alpha,
      beta,
      gamma,
      timestamp: timestamp ?? Date.now(),
    });
  });

  socket.on('calibration_offset', ({ roomCode, alpha = 0, beta = 0, gamma = 0 }) => {
    if (!roomCode) return;
    socket.to(roomCode).emit('calibration_offset', {
      alpha,
      beta,
      gamma,
      timestamp: Date.now(),
    });
  });
});

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  console.log(`Socket server running on http://localhost:${PORT}`);
});
