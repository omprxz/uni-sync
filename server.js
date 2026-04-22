require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const helmet = require('helmet');
const path = require('path');
const expressLayouts = require('express-ejs-layouts');

const indexRouter = require('./routes/index');
const roomsRouter = require('./routes/rooms');
const apiRouter = require('./routes/api');
const authRouter = require('./routes/auth');
const initSocket = require('./sockets/roomSocket');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const passport = require('./config/passport');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  connectionStateRecovery: {
    maxDisconnectionDuration: 2 * 60 * 1000,
    skipMiddlewares: true
  }
});

// Security headers (relaxed CSP for CDN assets)
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://cdn.tailwindcss.com", "https://cdnjs.cloudflare.com", "https://cdn.jsdelivr.net"],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdnjs.cloudflare.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdnjs.cloudflare.com"],
      imgSrc: ["'self'", "data:", "https:", "http:"],
      connectSrc: ["'self'", "ws:", "wss:"],
    }
  }
}));

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(expressLayouts);
app.set('layout', 'layout');

// Body parsing + static
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Session
const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/droproom';
app.use(session({
  secret: process.env.SESSION_SECRET || 'fallback_secret',
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({ mongoUrl: MONGO_URI }),
  cookie: { maxAge: 1000 * 60 * 60 * 24 * 30 } // 30 days
}));

// Passport
app.use(passport.initialize());
app.use(passport.session());

// Provide user to views
app.use((req, res, next) => {
  res.locals.user = req.user || null;
  next();
});

// Attach io to every request
app.use((req, res, next) => { req.io = io; next(); });

// Routes
app.use('/', indexRouter);
app.use('/auth', authRouter);
app.use('/rooms', roomsRouter);
app.use('/api', apiRouter);
app.use('/api/upload', require('./routes/upload'));

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    db: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
  });
});

// 404
app.use((req, res) => {
  res.status(404).render('home', { title: '404 — DropRoom', error: 'Page not found.', layout: 'layout' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send('Internal Server Error');
});

// Connect to MongoDB then start
const PORT = process.env.PORT || 3000;

mongoose.connect(MONGO_URI)
  .then(() => {
    console.log('✅ Connected to MongoDB');
    initSocket(io);
    server.listen(PORT, () => {
      console.log(`🚀 DropRoom running at http://localhost:${PORT}`);
    });
  })
  .catch(err => {
    console.error('❌ MongoDB connection failed:', err.message);
    process.exit(1);
  });
