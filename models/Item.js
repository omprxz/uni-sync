const mongoose = require('mongoose');

const itemSchema = new mongoose.Schema({
  roomCode: { type: String, required: true, uppercase: true, index: true },
  type: { type: String, enum: ['text', 'link', 'code', 'markdown', 'image', 'file'], default: 'text' },
  category: { type: String, enum: ['General', 'Work', 'Study', 'Personal', 'Other'], default: 'General' },
  content: { type: String, required: true, maxlength: 1000000 },
  label: { type: String, maxlength: 200, default: '' },
  language: { type: String, default: null },
  ogData: {
    title: String, description: String,
    favicon: String, image: String,
    url: String, siteName: String
  },
  pinned: { type: Boolean, default: false },
  deleted: { type: Boolean, default: false },
  deletedAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, default: null }
});

itemSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, partialFilterExpression: { expiresAt: { $type: 'date' } } });

module.exports = mongoose.model('Item', itemSchema);
