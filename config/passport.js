const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const bcrypt = require('bcrypt');
const User = require('../models/User');

passport.use(new LocalStrategy({ usernameField: 'email' }, async (email, password, done) => {
  try {
    const user = await User.findOne({ email });
    if (!user) return done(null, false, { message: 'Incorrect email.' });
    if (!user.passwordHash) return done(null, false, { message: 'User does not have a password' });
    
    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) return done(null, false, { message: 'Incorrect password.' });
    
    return done(null, user);
  } catch (err) {
    return done(err);
  }
}));

passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID || 'dummy',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || 'dummy',
    callbackURL: "/auth/google/callback",
    passReqToCallback: true
  },
  async (req, accessToken, refreshToken, params, profile, done) => {
    try {
      const email = profile.emails[0].value;
      let user = null;
      if (req.user) {
        // Link to existing
        user = await User.findById(req.user._id);
        user.googleId = profile.id;
        user.googleEmail = email;
        user.googleTokens = {
          access_token: accessToken,
          refresh_token: refreshToken || user.googleTokens?.refresh_token,
          scope: params.scope,
          token_type: params.token_type,
          expiry_date: Date.now() + (params.expires_in * 1000)
        };
        await user.save();
      } else {
        // Login or create new
        user = await User.findOne({ email });
        if (!user) {
          user = new User({ email, googleId: profile.id, googleEmail: email });
        } else {
          user.googleId = profile.id;
          user.googleEmail = email;
        }
        user.googleTokens = {
            access_token: accessToken,
            refresh_token: refreshToken || user.googleTokens?.refresh_token,
            scope: params.scope,
            token_type: params.token_type,
            expiry_date: Date.now() + (params.expires_in * 1000)
        };
        await user.save();
      }
      return done(null, user);
    } catch (err) {
      return done(err);
    }
  }
));

passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findById(id);
    done(null, user);
  } catch (err) {
    done(err);
  }
});

module.exports = passport;
