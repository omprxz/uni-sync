const mongoose = require('mongoose');

const roomSchema = new mongoose.Schema({
  code: {
    type: String, required: true, unique: true,
    uppercase: true, trim: true, match: /^[A-Z0-9]{6}$/
  },
  passwordHash: { type: String, default: null },
  ownerToken: { type: String, required: true },
  ttl: { type: Number, default: null }, // seconds, null = never
  expiresAt: { type: Date, default: null },
  readOnly: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});

// TTL index — MongoDB auto-deletes expired rooms
roomSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, partialFilterExpression: { expiresAt: { $type: 'date' } } });

module.exports = mongoose.model('Room', roomSchema);
