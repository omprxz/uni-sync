const mongoose = require('mongoose');

const activitySchema = new mongoose.Schema({
  roomCode: { type: String, required: true, uppercase: true, index: true },
  action: { type: String, enum: ['added', 'edited', 'deleted', 'pinned', 'restored'], required: true },
  itemType: { type: String, default: 'text' },
  label: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now }
});

// Auto-delete activity after 24 hours
activitySchema.index({ createdAt: 1 }, { expireAfterSeconds: 86400 });

module.exports = mongoose.model('Activity', activitySchema);
