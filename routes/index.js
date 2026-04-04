const express = require('express');
const router = express.Router();

router.get('/', (req, res) => {
  res.render('home', {
    title: 'DropRoom — Drop Text. Share Instantly.',
    error: req.query.error || null,
    layout: 'layout'
  });
});

module.exports = router;
