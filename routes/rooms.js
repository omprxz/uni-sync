const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const Room = require('../models/Room');
const Item = require('../models/Item');
const { roomCreationLimiter } = require('../middleware/rateLimiter');

function generateCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function parseTTL(ttl) {
  const map = { '1h': 3600, '6h': 21600, '24h': 86400, '7d': 604800, 'never': null };
  return map[ttl] !== undefined ? map[ttl] : 86400;
}

const User = require('../models/User');

// POST /rooms — create a room
router.post('/', roomCreationLimiter, async (req, res) => {
  try {
    let { code, ttl, password } = req.body;

    if (!code || code.trim().length !== 6) {
      code = generateCode();
    } else {
      code = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (code.length !== 6) code = generateCode();
    }

    // If room exists and is active, just redirect into it
    const existing = await Room.findOne({ code });
    if (existing) {
      if (!existing.expiresAt || existing.expiresAt > new Date()) {
        return res.redirect(`/rooms/${code}`);
      }
      await Room.deleteOne({ code });
    }

    const ttlSeconds = parseTTL(ttl);
    const expiresAt = ttlSeconds ? new Date(Date.now() + ttlSeconds * 1000) : null;
    const passwordHash = password && password.trim() ? await bcrypt.hash(password, 10) : null;

    const newRoom = new Room({ code, passwordHash, ttl: ttlSeconds, expiresAt });
    if (req.user) {
      newRoom.createdBy = req.user._id;
      req.user.createdRooms.push({ roomCode: code });
      await req.user.save();
    }
    await newRoom.save();

    res.redirect(`/rooms/${code}`);
  } catch (err) {
    console.error(err);
    res.redirect('/?error=create_failed');
  }
});

// GET /rooms/:code — view/join a room
router.get('/:code', async (req, res) => {
  try {
    const code = req.params.code.toUpperCase();
    const room = await Room.findOne({ code });

    if (!room || (room.expiresAt && room.expiresAt < new Date())) {
      return res.render('home', {
        title: 'DropRoom', layout: 'layout',
        error: `Room "${code}" does not exist or has expired.`
      });
    }

    // Track in user joinedRooms
    let bypassPassword = false;
    if (req.user) {
      let isCreator = room.createdBy && room.createdBy.equals(req.user._id);

      const existingIndex = req.user.joinedRooms.findIndex(r => r.roomCode === code);
      let joinedData = { roomCode: code, joinedAt: new Date() };

      if (existingIndex > -1) {
        joinedData.lastPassword = req.user.joinedRooms[existingIndex].lastPassword;
        req.user.joinedRooms.splice(existingIndex, 1);
      }
      req.user.joinedRooms.unshift(joinedData);
      
      // limit to 20
      if (req.user.joinedRooms.length > 20) req.user.joinedRooms.pop();
      await req.user.save();

      // Check if quick login can be done
      if (isCreator || (room.passwordHash && req.query.verified !== '1' && joinedData.lastPassword)) {
        if (isCreator) bypassPassword = true;
        else if (joinedData.lastPassword) {
            const match = await bcrypt.compare(joinedData.lastPassword, room.passwordHash);
            if (match) bypassPassword = true;
        }
      }
    }

    // Password-protected room — show password page
    if (room.passwordHash && req.query.verified !== '1' && !bypassPassword) {
      return res.render('password', {
        title: `Enter Password — ${code} — DropRoom`,
        code, error: req.query.error || null, layout: 'layout'
      });
    }

    const items = await Item.find({ roomCode: code, deleted: false })
      .sort({ pinned: -1, createdAt: -1 }).lean();

    res.render('room', {
      title: `${code} — DropRoom`,
      layout: 'layout',
      roomCode: code,
      initialItems: JSON.stringify(items),
      roomData: JSON.stringify({
        code: room.code,
        expiresAt: room.expiresAt,
        ttl: room.ttl,
        hasPassword: !!room.passwordHash
      })
    });
  } catch (err) {
    console.error(err);
    res.redirect('/');
  }
});

// POST /rooms/:code/verify — verify room password
router.post('/:code/verify', async (req, res) => {
  try {
    const code = req.params.code.toUpperCase();
    const room = await Room.findOne({ code });
    if (!room) return res.redirect(`/rooms/${code}`);

    const pwd = req.body.password || '';
    const match = await bcrypt.compare(pwd, room.passwordHash);
    if (!match) return res.redirect(`/rooms/${code}?error=wrong_password`);

    if (req.user) {
      const idx = req.user.joinedRooms.findIndex(r => r.roomCode === code);
      if (idx > -1) req.user.joinedRooms[idx].lastPassword = pwd;
      else req.user.joinedRooms.unshift({ roomCode: code, lastPassword: pwd, joinedAt: new Date() });
      await req.user.save();
    }

    res.redirect(`/rooms/${code}?verified=1`);
  } catch (err) {
    console.error(err);
    res.redirect(`/rooms/${req.params.code}`);
  }
});

// GET /rooms/:code/item/:itemId — single item share page
router.get('/:code/item/:itemId', async (req, res) => {
  try {
    const code = req.params.code.toUpperCase();
    const item = await Item.findById(req.params.itemId).lean();

    if (!item || item.roomCode !== code || item.deleted) {
      return res.render('home', { title: 'DropRoom', layout: 'layout', error: 'Item not found.' });
    }

    res.render('item-share', {
      title: `${item.label || 'Shared Item'} — DropRoom`,
      layout: 'layout', item, roomCode: code
    });
  } catch (err) {
    res.redirect('/');
  }
});

module.exports = router;
