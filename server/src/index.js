import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import * as Y from 'yjs';
import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

const PORT = process.env.PORT || 5000;
const NODE_ENV = process.env.NODE_ENV || 'development';

// Parse allowed client origins for CORS
const clientUrlEnv = process.env.CLIENT_URL || '';
const parsedOrigins = clientUrlEnv
  ? clientUrlEnv.split(',').map((url) => url.trim()).filter(Boolean)
  : [];

// Development fallback origins
const defaultOrigins = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:3000',
  'http://localhost:4173',
];

const allowedOrigins = parsedOrigins.length > 0 ? parsedOrigins : defaultOrigins;
const isWildcardOrigin = allowedOrigins.includes('*');

const checkCorsOrigin = (origin, callback) => {
  // Allow requests with no origin (e.g. mobile apps, curl, Postman, server-to-server)
  if (!origin || isWildcardOrigin) {
    return callback(null, true);
  }
  if (allowedOrigins.includes(origin)) {
    return callback(null, true);
  }
  // In development, allow any localhost/127.0.0.1 port
  if (NODE_ENV !== 'production' && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
    return callback(null, true);
  }
  console.warn(`[CORS] Blocked request from origin: ${origin}`);
  return callback(new Error(`Origin ${origin} not allowed by CORS`));
};

const app = express();

// Middleware
app.use(
  cors({
    origin: isWildcardOrigin ? '*' : checkCorsOrigin,
    credentials: true,
  })
);
app.use(express.json());

// Room state storage
// Structure:
// roomId -> {
//   ydoc: Y.Doc,
//   language: string,
//   users: Map(socketId -> { username, color, voiceState })
// }
const rooms = new Map();

// Service Health & Status Endpoints
app.get('/', (req, res) => {
  res.json({
    name: 'CoCode Collaborative Code Editor API',
    status: 'online',
    version: '1.0.0',
    environment: NODE_ENV,
    activeRooms: rooms.size,
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    activeRooms: rooms.size,
    activeConnections: io.engine ? io.engine.clientsCount : 0,
  });
});

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: isWildcardOrigin ? '*' : allowedOrigins,
    methods: ['GET', 'POST'],
    credentials: true,
  },
  maxHttpBufferSize: 1e8, // Allow syncing larger documents (100MB)
  pingTimeout: 30000,
  pingInterval: 25000,
});

const CURSOR_COLORS = [
  '#FF5733', // Coral
  '#3B82F6', // Blue
  '#10B981', // Emerald
  '#F59E0B', // Amber
  '#EC4899', // Rose
  '#8B5CF6', // Violet
  '#06B6D4', // Cyan
  '#F43F5E', // Rose
  '#14B8A6', // Teal
  '#84CC16', // Lime
];

io.on('connection', (socket) => {
  console.log(`[Socket] Client connected: ${socket.id}`);

  // Join Room
  socket.on('join-room', ({ roomId, username }) => {
    if (!roomId || !username) return;

    socket.join(roomId);
    console.log(`[Room ${roomId}] User "${username}" (${socket.id}) joined`);

    // Create room if it doesn't exist
    if (!rooms.has(roomId)) {
      const ydoc = new Y.Doc();
      const ytext = ydoc.getText('monaco');

      // Initialize with default template text
      ytext.insert(
        0,
        `// Welcome to CoCode Room ${roomId}!\n// Start coding together in real-time.\n\nfunction helloWorld() {\n  console.log("Hello, collaborative world!");\n}\n`
      );

      rooms.set(roomId, {
        ydoc,
        language: 'javascript',
        users: new Map(),
      });
    }

    const room = rooms.get(roomId);
    const color = CURSOR_COLORS[room.users.size % CURSOR_COLORS.length];

    // Save user info
    room.users.set(socket.id, {
      id: socket.id,
      username,
      color,
      voiceState: { inVoice: false, muted: false },
    });

    // Serialize current Y.Doc state as a full update
    const docUpdate = Y.encodeStateAsUpdate(room.ydoc);

    // Send initial state back to client
    socket.emit('room-init', {
      docUpdate: Buffer.from(docUpdate), // Socket.io handles Buffer efficiently
      language: room.language,
      users: Array.from(room.users.values()),
    });

    // Broadcast updated users to room members
    socket.to(roomId).emit('users-update', Array.from(room.users.values()));
  });

  // Handle Yjs incremental updates (binary data)
  socket.on('yjs-update', ({ roomId, update }) => {
    const room = rooms.get(roomId);
    if (!room) return;

    try {
      // update is received as a Node Buffer from Socket.io, which matches Uint8Array
      Y.applyUpdate(room.ydoc, update);

      // Broadcast update to all other clients in the room
      socket.to(roomId).emit('yjs-update', update);
    } catch (err) {
      console.error(`[Error] Applying Yjs update in room ${roomId}:`, err);
    }
  });

  // Handle Yjs awareness updates (cursors, selections)
  socket.on('awareness-update', ({ roomId, update }) => {
    // Simply broadcast the awareness state to other clients
    socket.to(roomId).emit('awareness-update', update);
  });

  // Handle language selection changes
  socket.on('language-change', ({ roomId, language }) => {
    const room = rooms.get(roomId);
    if (!room) return;

    room.language = language;
    socket.to(roomId).emit('language-update', { language });
  });

  // Handle Text Chat messages
  socket.on('chat-message', ({ roomId, message }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    const user = room.users.get(socket.id);
    if (!user) return;

    const payload = {
      id: Math.random().toString(36).substring(2, 9),
      userId: socket.id,
      username: user.username,
      color: user.color,
      text: message,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    io.to(roomId).emit('chat-message', payload);
  });

  // Handle WebRTC voice signaling messages
  socket.on('webrtc-signal', ({ targetId, signal }) => {
    io.to(targetId).emit('webrtc-signal', {
      senderId: socket.id,
      signal,
    });
  });

  // Handle client voice state updates (mic muted, speaker talking)
  socket.on('voice-state-change', ({ roomId, voiceState }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    const user = room.users.get(socket.id);
    if (!user) return;

    user.voiceState = voiceState;
    socket.to(roomId).emit('voice-state-update', {
      userId: socket.id,
      voiceState,
    });
  });

  // Handle disconnection
  socket.on('disconnecting', () => {
    for (const roomId of socket.rooms) {
      if (rooms.has(roomId)) {
        const room = rooms.get(roomId);
        room.users.delete(socket.id);

        if (room.users.size === 0) {
          // All users left: clean up memory and destroy Yjs doc
          try {
            room.ydoc.destroy();
          } catch (e) {
            console.error(`[Error] Destroying Y.Doc in room ${roomId}:`, e);
          }
          rooms.delete(roomId);
          console.log(`[Room ${roomId}] Cleaned up and destroyed.`);
        } else {
          socket.to(roomId).emit('users-update', Array.from(room.users.values()));
        }
      }
    }
  });

  socket.on('disconnect', (reason) => {
    console.log(`[Socket] Client disconnected (${socket.id}): ${reason}`);
  });
});

// Start listening
httpServer.listen(PORT, () => {
  console.log(`===============================================`);
  console.log(`🚀 CoCode Collaborative Server`);
  console.log(`📡 Environment: ${NODE_ENV}`);
  console.log(`🚪 Port: ${PORT}`);
  console.log(`🌐 Allowed Origins: ${isWildcardOrigin ? '*' : allowedOrigins.join(', ')}`);
  console.log(`===============================================`);
});

// Graceful shutdown handling
const handleGracefulShutdown = (signal) => {
  console.log(`\n[${signal}] Received shutdown signal. Closing server gracefully...`);

  // Destroy all active rooms and docs
  for (const [roomId, room] of rooms.entries()) {
    try {
      room.ydoc.destroy();
    } catch (e) {
      // ignore
    }
  }
  rooms.clear();

  io.close(() => {
    console.log('[Socket.io] All connections closed.');
    httpServer.close(() => {
      console.log('[HTTP] Server terminated successfully.');
      process.exit(0);
    });
  });

  // Force exit if hanging after 10 seconds
  setTimeout(() => {
    console.error('[Shutdown] Forced termination after timeout.');
    process.exit(1);
  }, 10000).unref();
};

process.on('SIGTERM', () => handleGracefulShutdown('SIGTERM'));
process.on('SIGINT', () => handleGracefulShutdown('SIGINT'));
