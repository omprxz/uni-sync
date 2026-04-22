const mongoose = require('mongoose');

const roomSchema = new mongoose.Schema({
  code: {
    type: String, required: true, unique: true,
    uppercase: true, trim: true, match: /^[A-Z0-9]{6}$/
  },
  passwordHash: { type: String, default: null },
  ttl: { type: Number, default: null }, // seconds, null = never
  expiresAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }
});

// TTL index — MongoDB auto-deletes expired rooms
roomSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, partialFilterExpression: { expiresAt: { $type: 'date' } } });

module.exports = mongoose.model('Room', roomSchema);
