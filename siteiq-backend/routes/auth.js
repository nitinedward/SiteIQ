const express = require('express');
const router = express.Router();
const supabase = require('../../lib/supabase');

// POST /api/auth/login
// Called by index.tsx when engineer taps "Log In"
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  // Supabase handles the login check for us
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    return res.status(401).json({ error: 'Incorrect email or password' });
  }

  // Send back the user and their session token
  return res.json({
    success: true,
    user: data.user,
    token: data.session.access_token,
  });
});

// POST /api/auth/logout
router.post('/logout', async (req, res) => {
  await supabase.auth.signOut();
  res.json({ success: true });
});

module.exports = router;