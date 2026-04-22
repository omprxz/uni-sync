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
    const room = await Room.findOne({ code: req.params.code.toUpperCase() }).select('-passwordHash');
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

    let { content, label, type, category } = req.body;
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
      category: category || 'General',
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

    // Trigger Filebin API deletion if type is 'file'
    if (item.type === 'file' && item.ogData && item.ogData.url) {
      try {
        await axios.delete(`https://filebin.net/${item.ogData.url}`);
      } catch (err) {
        console.error('Filebin delete failed:', err.message);
      }
    }
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

// PUT /api/items/:id/pin — toggle pin
router.put('/items/:id/pin', async (req, res) => {
  try {
    const item = await Item.findById(req.params.id);
    if (!item) return res.status(404).json({ error: 'Not found' });
    const room = await Room.findOne({ code: item.roomCode });
    if (!room) return res.status(404).json({ error: 'Room not found' });
    item.pinned = !item.pinned;
    await item.save();
    if (req.io) req.io.to(item.roomCode).emit('item-pinned', { id: item._id, pinned: item.pinned });
    res.json({ pinned: item.pinned });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/og — fetch open graph for URL
router.get('/og', async (req, res) => {
  try {
    if (!req.query.url) return res.status(400).json({ error: 'url required' });
    res.json(await fetchOG(req.query.url) || {});
  } catch (e) { res.status(500).json({ error: e.message }); }
});

const { google } = require('googleapis');

// POST /api/items/:id/drive — add item to Google Drive
router.post('/items/:id/drive', async (req, res) => {
  try {
    if (!req.user || !req.user.googleTokens || !req.user.googleTokens.access_token) {
      return res.status(401).json({ error: 'Google account not linked' });
    }

    const item = await Item.findById(req.params.id);
    if (!item || item.deleted) return res.status(404).json({ error: 'Item not found' });

    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials(req.user.googleTokens);
    const drive = google.drive({ version: 'v3', auth: oauth2Client });

    // Ensure DropRoom folder exists
    let folderId = null;
    const folderRes = await drive.files.list({
      q: "name='DropRoom' and mimeType='application/vnd.google-apps.folder' and trashed=false",
      fields: "files(id)"
    });
    if (folderRes.data.files.length > 0) {
      folderId = folderRes.data.files[0].id;
    } else {
      const newFolder = await drive.files.create({
        requestBody: { name: 'DropRoom', mimeType: 'application/vnd.google-apps.folder' },
        fields: 'id'
      });
      folderId = newFolder.data.id;
    }

    // Ensure room folder exists
    let roomFolderId = null;
    const roomFolderRes = await drive.files.list({
      q: `name='${item.roomCode}' and parents in '${folderId}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: "files(id)"
    });
    if (roomFolderRes.data.files.length > 0) {
      roomFolderId = roomFolderRes.data.files[0].id;
    } else {
      const newRoomFolder = await drive.files.create({
        requestBody: { name: item.roomCode, parents: [folderId], mimeType: 'application/vnd.google-apps.folder' },
        fields: 'id'
      });
      roomFolderId = newRoomFolder.data.id;
    }

    // Upload file
    const fileMetadata = {
      name: item.label || `item-${item._id}`,
      parents: [roomFolderId]
    };

    let media;
    if (item.type === 'file' || item.type === 'image') {
      const response = await axios.get(item.content, { responseType: 'stream' });
      media = { body: response.data };
      if (!fileMetadata.name.includes('.')) {
        // give it an extension based on type, ideally could inspect content-type
        fileMetadata.name += item.type === 'image' ? '.png' : '.bin';
      }
    } else {
      media = { mimeType: 'text/plain', body: item.content };
      fileMetadata.name += '.txt';
    }

    const driveFile = await drive.files.create({
      requestBody: fileMetadata,
      media: media,
      fields: 'id'
    });

    res.json({ success: true, fileId: driveFile.data.id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to upload to Drive' });
  }
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
