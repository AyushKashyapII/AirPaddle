# AirPaddle

Real-time web app where your phone gyro controls a paddle on desktop using React, Node.js, and Socket.io.

## Project structure

- `client` - React + Vite frontend (desktop screen + mobile controller views)
- `server` - Node.js + Express + Socket.io room relay server

## Run locally

Open two terminals:

1) Start backend

```bash
cd server
npm run dev
```

2) Start frontend

```bash
cd client
npm run dev:host
```

Then open:

- Desktop screen: `http://localhost:5173` (or your LAN IP shown by Vite)
- Mobile controller: scan QR from desktop (or open `http://localhost:5173?room=1234`)

## How it works

- Desktop generates a random 4-digit room code
- Desktop joins that room and listens for `gyro_data`
- Mobile joins the same room after "Connect & Calibrate"
- Mobile reads `DeviceOrientationEvent` and emits orientation ~30 FPS
- Server relays events only to sockets in the same room

## Using ngrok (for phone + HTTPS sensors)

1. Run both apps:
   - `server`: `npm run dev`
   - `client`: `npm run dev:host`
2. Start tunnel:
   - `ngrok http 5173`
3. Open the ngrok HTTPS URL on desktop.
4. Use QR or "Copy Controller Link" for your phone.

The Vite dev server is configured to allow ngrok hosts and proxy `/socket.io` to `localhost:3001`.

TRYING RL first 
