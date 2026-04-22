const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  name: { type: String, trim: true },
  username: { type: String, unique: true, sparse: true, trim: true },
  profilePic: { type: String },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String },
  googleId: { type: String },
  googleTokens: {
    access_token: String,
    refresh_token: String,
    scope: String,
    token_type: String,
    expiry_date: Number
  },
  joinedRooms: [{
    roomCode: { type: String, uppercase: true },
    joinedAt: { type: Date, default: Date.now },
    lastPassword: { type: String },
    pinned: { type: Boolean, default: false }
  }],
  createdRooms: [{
    roomCode: { type: String, uppercase: true },
    createdAt: { type: Date, default: Date.now }
  }],
  pinnedRooms: [{ type: String, uppercase: true }],
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('User', userSchema);
