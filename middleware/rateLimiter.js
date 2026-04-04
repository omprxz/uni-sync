const rateLimit = require('express-rate-limit');

const roomCreationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX_ROOM_CREATION) || 10,
  message: { error: 'Too many room creation requests. Try again later.' },
  standardHeaders: true, legacyHeaders: false
});

const itemSubmitLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX_ITEM_SUBMIT) || 100,
  message: { error: 'Too many item requests. Try again later.' },
  standardHeaders: true, legacyHeaders: false
});

module.exports = { roomCreationLimiter, itemSubmitLimiter };
