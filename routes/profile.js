const express = require('express');
const router = express.Router();
const User = require('../models/User');
const bcrypt = require('bcrypt');
const axios = require('axios');
const multer = require('multer');
const FormData = require('form-data');

function requireAuth(req, res, next) {
  if (!req.user) return res.redirect('/?error=login_required');
  next();
}

const upload = multer({ storage: multer.memoryStorage() });

router.get('/', requireAuth, (req, res) => {
  res.render('profile', {
    title: 'My Profile — DropRoom',
    user: req.user,
    layout: 'layout'
  });
});

router.post('/update', requireAuth, upload.single('profilePic'), async (req, res) => {
  try {
    const { name, username, email, password } = req.body;
    const user = await User.findById(req.user._id);

    if (name) user.name = name.trim();
    if (username) user.username = username.trim();
    if (email) user.email = email.trim().toLowerCase();
    
    if (password && password.length > 0) {
      user.passwordHash = await bcrypt.hash(password, 10);
    }

    if (req.file) {
      const form = new FormData();
      form.append('image', req.file.buffer.toString('base64'));
      
      const imgbbRes = await axios.post(`https://api.imgbb.com/1/upload?key=${process.env.IMGBB_API_KEY}`, form, {
        headers: form.getHeaders()
      });
      
      if (imgbbRes.data && imgbbRes.data.data && imgbbRes.data.data.url) {
        user.profilePic = imgbbRes.data.data.url;
      }
    }

    await user.save();
    res.redirect('/profile?success=1');
  } catch (err) {
    res.redirect('/profile?error=' + encodeURIComponent(err.message));
  }
});

router.post('/unlink-google', requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    user.googleId = undefined;
    user.googleTokens = undefined;
    await user.save();
    res.redirect('/profile?success=unlinked');
  } catch (err) {
    res.redirect('/profile?error=failed_unlink');
  }
});

module.exports = router;
