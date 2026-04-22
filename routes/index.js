const express = require('express');
const router = express.Router();
const Room = require('../models/Room');
const User = require('../models/User');

router.get('/', async (req, res) => {
  let enrichedRooms = [];
  if (req.user && req.user.joinedRooms && req.user.joinedRooms.length > 0) {
    const codes = req.user.joinedRooms.map(r => r.roomCode);
    const rooms = await Room.find({ code: { $in: codes } }).populate('createdBy', 'name username email').lean();
    const roomsMap = {};
    rooms.forEach(r => roomsMap[r.code] = r);

    enrichedRooms = req.user.joinedRooms.map(r => {
      const roomInfo = roomsMap[r.roomCode];
      return {
        roomCode: r.roomCode,
        pinned: r.pinned,
        joinedAt: r.joinedAt,
        creatorName: roomInfo && roomInfo.createdBy ? (roomInfo.createdBy.name || roomInfo.createdBy.username || roomInfo.createdBy.email) : 'System'
      };
    });
    
    // Sort pinned first, then by joinedAt desc
    enrichedRooms.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return new Date(b.joinedAt) - new Date(a.joinedAt);
    });
  }

  res.render('home', {
    title: 'DropRoom — Drop Text. Share Instantly.',
    error: req.query.error || null,
    layout: 'layout',
    enrichedRooms
  });
});

module.exports = router;
