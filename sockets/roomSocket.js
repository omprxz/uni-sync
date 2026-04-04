const Activity = require('../models/Activity');

// Track socket IDs per room
const roomUsers = new Map();

function initSocket(io) {
  io.on('connection', (socket) => {
    let currentRoom = null;

    socket.on('join-room', async ({ roomCode }) => {
      if (!roomCode) return;
      const code = roomCode.toUpperCase();
      currentRoom = code;
      socket.join(code);
      if (!roomUsers.has(code)) roomUsers.set(code, new Set());
      roomUsers.get(code).add(socket.id);
      io.to(code).emit('user-count', roomUsers.get(code).size);

      try {
        const acts = await Activity.find({ roomCode: code })
          .sort({ createdAt: -1 }).limit(10).lean();
        socket.emit('activity-history', acts.reverse());
      } catch {}
    });

    socket.on('typing', ({ roomCode, isTyping }) => {
      if (roomCode) socket.to(roomCode.toUpperCase()).emit('user-typing', { socketId: socket.id, isTyping });
    });

    socket.on('disconnect', () => {
      if (!currentRoom) return;
      if (roomUsers.has(currentRoom)) {
        roomUsers.get(currentRoom).delete(socket.id);
        const size = roomUsers.get(currentRoom).size;
        if (size === 0) roomUsers.delete(currentRoom);
        else io.to(currentRoom).emit('user-count', size);
      }
    });
  });
}

module.exports = initSocket;
