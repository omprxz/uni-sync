const express = require('express');
const router = express.Router();
const Room = require('../models/Room');

function requireAuth(req, res, next) {
  if (!req.user) return res.redirect('/?error=login_required');
  next();
}

router.get('/', requireAuth, async (req, res) => {
  try {
    const rooms = await Room.find({ createdBy: req.user._id }).sort({ createdAt: -1 }).lean();
    res.render('my-rooms', {
      title: 'My Created Rooms — DropRoom',
      rooms: rooms,
      layout: 'layout'
    });
  } catch (err) {
    res.redirect('/?error=Failed to load rooms');
  }
});

module.exports = router;
