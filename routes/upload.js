const express = require('express');
const router = express.Router();
const multer = require('multer');
const axios = require('axios');
const FormData = require('form-data');
const Room = require('../models/Room');
const Item = require('../models/Item');
const Activity = require('../models/Activity');
const { itemSubmitLimiter } = require('../middleware/rateLimiter');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } }); // 10MB limit

function generateRandomStr(length) {
    let result = '';
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < length; i++) {
      result += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    return result;
}

// POST /api/upload/image
router.post('/image', upload.single('file'), itemSubmitLimiter, async (req, res) => {
  try {
    const { code, label } = req.body;
    if (!req.file) return res.status(400).json({ error: 'No file provided' });
    if (!code) return res.status(400).json({ error: 'Room code required' });

    const room = await Room.findOne({ code: code.toUpperCase() });
    if (!room) return res.status(404).json({ error: 'Room not found' });
    if (room.readOnly) return res.status(403).json({ error: 'Room is read-only' });

    const form = new FormData();
    form.append('image', req.file.buffer, req.file.originalname);
    
    // ImgBB requires key
    const imgbbKey = process.env.IMGBB_API_KEY || '15c2d3ca4ee7bc6247cf743b1cc70bf9'; // Fallback free key for testing
    const response = await axios.post(`https://api.imgbb.com/1/upload?key=${imgbbKey}`, form, {
      headers: form.getHeaders(),
    });

    if (response.data && response.data.data) {
      const url = response.data.data.url;
      const deleteUrl = response.data.data.delete_url || '';
      
      const item = await Item.create({
        roomCode: room.code,
        type: 'image',
        content: url, // content stores the url
        label: label || req.file.originalname,
        expiresAt: room.expiresAt || null,
        ogData: { url: deleteUrl } // Store deleteUrl in ogData.url placeholder secretly to delete manually later if needed
      });

      await Activity.create({ roomCode: room.code, action: 'added', itemType: 'image', label: req.file.originalname });
      if (req.io) {
        req.io.to(room.code).emit('item-added', item);
        req.io.to(room.code).emit('activity', { action: 'added', itemType: 'image', label: req.file.originalname, timestamp: new Date() });
      }
      return res.json(item);
    }
    res.status(500).json({ error: 'ImgBB upload failed' });
  } catch (e) {
    console.error(e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/upload/file
router.post('/file', upload.single('file'), itemSubmitLimiter, async (req, res) => {
  try {
    const { code, label } = req.body;
    if (!req.file) return res.status(400).json({ error: 'No file provided' });
    if (!code) return res.status(400).json({ error: 'Room code required' });

    const room = await Room.findOne({ code: code.toUpperCase() });
    if (!room) return res.status(404).json({ error: 'Room not found' });
    if (room.readOnly) return res.status(403).json({ error: 'Room is read-only' });

    // Filebin logic
    const binId = generateRandomStr(16);
    const filename = encodeURIComponent(req.file.originalname);
    const filebinUrl = `https://filebin.net/${binId}/${filename}`;

    await axios.post(filebinUrl, req.file.buffer, {
      headers: {
        'Content-Type': req.file.mimetype,
        'Content-Length': req.file.size,
        'Accept': 'application/json'
      }
    });

    const item = await Item.create({
      roomCode: room.code,
      type: 'file',
      content: filebinUrl, // content stores the url
      label: label || req.file.originalname,
      expiresAt: room.expiresAt || null,
      ogData: { url: binId } // Store binId in ogData.url for deletion
    });

    await Activity.create({ roomCode: room.code, action: 'added', itemType: 'file', label: req.file.originalname });
    if (req.io) {
      req.io.to(room.code).emit('item-added', item);
      req.io.to(room.code).emit('activity', { action: 'added', itemType: 'file', label: req.file.originalname, timestamp: new Date() });
    }
    return res.json(item);
  } catch (e) {
    console.error(e.message);
    res.status(500).json({ error: e.message });
  }
});

// DELETE Filebin proxy route to be called by frontend? No, we should hook it into our soft delete. Wait, the user said "trigger delete requests to Filebin API when an item is deleted". We will handle it in api.js

module.exports = router;