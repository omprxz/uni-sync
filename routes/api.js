const express = require('express');
const router = express.Router();
const axios = require('axios');
const cheerio = require('cheerio');
const sanitizeHtml = require('sanitize-html');
const Room = require('../models/Room');
const Item = require('../models/Item');
const Activity = require('../models/Activity');
const { itemSubmitLimiter } = require('../middleware/rateLimiter');

// ─── Helpers ────────────────────────────────────────────────────────────────

function sanitize(str) {
  return sanitizeHtml(String(str || ''), { allowedTags: [], allowedAttributes: {} });
}

function detectType(content) {
  const trimmed = content.trim();
  if (/^https?:\/\/[^\s]+$/.test(trimmed)) return 'link';
  if (isCode(trimmed)) return 'code';
  if (isMarkdown(trimmed)) return 'markdown';
  return 'text';
}

function isCode(s) {
  const indicators = [
    /^(function |const |let |var |class |import |export |if\s*\(|for\s*\(|while\s*\(|return )/m,
    /^(def |import |from |class |print\()/m,
    /^(public |private |protected |static |void |int |string )/m,
    /^#include\s*</m, /^\s*<\?php/m,
    /```/, /^\s*\{[\s\S]+\}\s*$/
  ];
  return indicators.filter(r => r.test(s)).length >= 2;
}

function isMarkdown(s) {
  const indicators = [/^#{1,6} /m, /\*\*.+\*\*/, /^\- /m, /^\d+\. /m, /\[.+\]\(.+\)/, /^> /m, /```/];
  return indicators.filter(r => r.test(s)).length >= 2;
}

function detectLanguage(s) {
  if (/def |import |print\(/.test(s)) return 'python';
  if (/function |const |let |var |=>/.test(s)) return 'javascript';
  if (/public class|public static void main/.test(s)) return 'java';
  if (/#include|int main/.test(s)) return 'cpp';
  if (/<\?php/.test(s)) return 'php';
  if (/SELECT |FROM |WHERE /i.test(s)) return 'sql';
  if (/^<[a-zA-Z]/.test(s.trim())) return 'html';
  try { JSON.parse(s); return 'json'; } catch {}
  return null;
}

async function fetchOG(url) {
  try {
    const res = await axios.get(url, {
      timeout: 5000,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DropRoom/1.0)' },
      maxContentLength: 500000
    });
    const $ = cheerio.load(res.data);
    const hn = new URL(url).hostname;
    return {
      title: $('meta[property="og:title"]').attr('content') || $('title').text() || '',
      description: $('meta[property="og:description"]').attr('content') || $('meta[name="description"]').attr('content') || '',
      image: $('meta[property="og:image"]').attr('content') || '',
      favicon: `https://www.google.com/s2/favicons?domain=${hn}&sz=64`,
      siteName: $('meta[property="og:site_name"]').attr('content') || hn,
      url
    };
  } catch {
    try {
      const hn = new URL(url).hostname;
      return { title: '', description: '', image: '', favicon: `https://www.google.com/s2/favicons?domain=${hn}&sz=64`, siteName: hn, url };
    } catch { return null; }
  }
}

// ─── Routes ─────────────────────────────────────────────────────────────────

// GET /api/rooms/:code
router.get('/rooms/:code', async (req, res) => {
  try {
    const room = await Room.findOne({ code: req.params.code.toUpperCase() }).select('-passwordHash -ownerToken');
    if (!room) return res.status(404).json({ error: 'Room not found' });
    res.json(room);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/rooms/:code/items
router.get('/rooms/:code/items', async (req, res) => {
  try {
    const code = req.params.code.toUpperCase();
    const room = await Room.findOne({ code });
    if (!room) return res.status(404).json({ error: 'Room not found' });
    const items = await Item.find({ roomCode: code, deleted: false }).sort({ pinned: -1, createdAt: -1 });
    res.json(items);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/rooms/:code/items — add item (REST + socket alike)
router.post('/rooms/:code/items', itemSubmitLimiter, async (req, res) => {
  try {
    const code = req.params.code.toUpperCase();
    const room = await Room.findOne({ code });
    if (!room) return res.status(404).json({ error: 'Room not found' });
    if (room.readOnly) return res.status(403).json({ error: 'Room is read-only' });

    let { content, label, type } = req.body;
    content = sanitize((content || '').trim());
    label = sanitize((label || '').trim());

    if (!content) return res.status(400).json({ error: 'Content is required' });
    if (content.length > 10000) return res.status(400).json({ error: 'Content exceeds 10,000 characters' });

    if (!type) type = detectType(content);
    let ogData = null, language = null;
    if (type === 'link') ogData = await fetchOG(content);
    if (type === 'code') language = detectLanguage(content);

    const item = await Item.create({
      roomCode: code, type, content, label, language, ogData,
      expiresAt: room.expiresAt || null
    });

    await Activity.create({ roomCode: code, action: 'added', itemType: type, label });
    if (req.io) {
      req.io.to(code).emit('item-added', item);
      req.io.to(code).emit('activity', { action: 'added', itemType: type, label, timestamp: new Date() });
    }
    res.status(201).json(item);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/items/:id — edit
router.put('/items/:id', itemSubmitLimiter, async (req, res) => {
  try {
    const item = await Item.findById(req.params.id);
    if (!item || item.deleted) return res.status(404).json({ error: 'Not found' });

    const room = await Room.findOne({ code: item.roomCode });
    if (room?.readOnly) return res.status(403).json({ error: 'Room is read-only' });

    if (req.body.content !== undefined) {
      item.content = sanitize(req.body.content.trim());
      if (item.content.length > 10000) return res.status(400).json({ error: 'Too long' });
      item.type = detectType(item.content);
      item.language = item.type === 'code' ? detectLanguage(item.content) : null;
      item.ogData = item.type === 'link' ? await fetchOG(item.content) : null;
    }
    if (req.body.label !== undefined) item.label = sanitize(req.body.label.trim());
    await item.save();

    if (req.io) req.io.to(item.roomCode).emit('item-edited', item);
    await Activity.create({ roomCode: item.roomCode, action: 'edited', itemType: item.type, label: item.label });
    res.json(item);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/items/:id — soft delete
router.delete('/items/:id', async (req, res) => {
  try {
    const item = await Item.findById(req.params.id);
    if (!item || item.deleted) return res.status(404).json({ error: 'Not found' });
    item.deleted = true; item.deletedAt = new Date();
    await item.save();
    if (req.io) req.io.to(item.roomCode).emit('item-deleted', { id: item._id });
    await Activity.create({ roomCode: item.roomCode, action: 'deleted', itemType: item.type, label: item.label });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/items/:id/restore — undo delete (60s window)
router.post('/items/:id/restore', async (req, res) => {
  try {
    const item = await Item.findById(req.params.id);
    if (!item) return res.status(404).json({ error: 'Not found' });
    if (item.deletedAt && Date.now() - item.deletedAt.getTime() > 60000)
      return res.status(400).json({ error: 'Undo window expired' });
    item.deleted = false; item.deletedAt = null;
    await item.save();
    if (req.io) req.io.to(item.roomCode).emit('item-restored', item);
    res.json(item);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/items/:id/pin — toggle pin (owner only)
router.put('/items/:id/pin', async (req, res) => {
  try {
    const item = await Item.findById(req.params.id);
    if (!item) return res.status(404).json({ error: 'Not found' });
    const room = await Room.findOne({ code: item.roomCode });
    if (!room || room.ownerToken !== req.body.ownerToken)
      return res.status(403).json({ error: 'Owner only' });
    item.pinned = !item.pinned;
    await item.save();
    if (req.io) req.io.to(item.roomCode).emit('item-pinned', { id: item._id, pinned: item.pinned });
    res.json({ pinned: item.pinned });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/rooms/:code/readonly — toggle read-only (owner only)
router.put('/rooms/:code/readonly', async (req, res) => {
  try {
    const room = await Room.findOne({ code: req.params.code.toUpperCase() });
    if (!room) return res.status(404).json({ error: 'Not found' });
    if (room.ownerToken !== req.body.ownerToken) return res.status(403).json({ error: 'Owner only' });
    room.readOnly = !room.readOnly;
    await room.save();
    if (req.io) req.io.to(room.code).emit('room-readonly', { readOnly: room.readOnly });
    res.json({ readOnly: room.readOnly });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/og — fetch open graph for URL
router.get('/og', async (req, res) => {
  try {
    if (!req.query.url) return res.status(400).json({ error: 'url required' });
    res.json(await fetchOG(req.query.url) || {});
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/rooms/:code/activity
router.get('/rooms/:code/activity', async (req, res) => {
  try {
    const acts = await Activity.find({ roomCode: req.params.code.toUpperCase() })
      .sort({ createdAt: -1 }).limit(20);
    res.json(acts);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /health
router.get('/health', (req, res) => res.json({ status: 'ok' }));

module.exports = router;
