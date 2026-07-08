import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import * as Y from 'yjs';

const app = express();
app.use(cors());

app.get('/health', (req, res) => {
  res.send({ status: 'ok', uptime: process.uptime() });
});

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
  maxHttpBufferSize: 1e8, // Allow syncing larger documents
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

// Room state storage
// Structure:
// roomId -> {
//   ydoc: Y.Doc,
//   language: string,
//   users: Map(socketId -> { username, color })
// }
const rooms = new Map();

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  // Join Room
  socket.on('join-room', ({ roomId, username }) => {
    if (!roomId || !username) return;

    socket.join(roomId);
    console.log(`User ${username} (${socket.id}) joined room: ${roomId}`);

    // Create room if it doesn't exist
    if (!rooms.has(roomId)) {
      const ydoc = new Y.Doc();
      const ytext = ydoc.getText('monaco');
      
      // Initialize with default template text
      ytext.insert(0, `// Welcome to CoCode Room ${roomId}!\n// Start coding together in real-time.\n\nfunction helloWorld() {\n  console.log("Hello, collaborative world!");\n}`);

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
      console.error(`Error applying Yjs update in room ${roomId}:`, err);
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
          // If no users left, clean up the room after a grace period or instantly
          rooms.delete(roomId);
          console.log(`Room ${roomId} deleted as all users left.`);
        } else {
          socket.to(roomId).emit('users-update', Array.from(room.users.values()));
        }
      }
    }
  });

  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
  });
});

const PORT = process.env.PORT || 5000;
httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
