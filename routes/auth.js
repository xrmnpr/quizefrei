const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db/database');
const { signToken, authenticate } = require('../middleware/auth');

const router = express.Router();

// ---------------------------------------------------------------------------
// Google sign-in via Azure App Service Easy Auth
// Azure injects X-MS-CLIENT-PRINCIPAL (base64 JSON) on every authenticated
// request — no token validation needed on our side.
// ---------------------------------------------------------------------------
router.post('/google', async (req, res) => {
  const principalHeader = req.headers['x-ms-client-principal'];
  if (!principalHeader) {
    return res.status(401).json({ error: 'No Azure auth session. Visit /.auth/login/google first.' });
  }

  try {
    const data = JSON.parse(Buffer.from(principalHeader, 'base64').toString('utf8'));
    const claims = Array.isArray(data.claims) ? data.claims : [];

    // Helper — check multiple possible claim type names (Azure uses SOAP-style URIs)
    const claim = (...types) => {
      for (const t of types) {
        const c = claims.find(x => x.typ === t);
        if (c?.val) return c.val;
      }
      return null;
    };

    const googleId = claim(
      'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier',
      'sub'
    );
    const email = (
      claim(
        'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress',
        'email',
        'emails',
        'preferred_username'
      ) || data.user_id || ''
    ).toLowerCase();
    const name = claim('name', 'display_name') || email;

    if (!email) {
      return res.status(400).json({ error: 'Google account did not provide an email address' });
    }

    // Find existing user by Google ID first, then fall back to email
    let user = googleId
      ? await db.queryOne('SELECT * FROM users WHERE google_id = $1', [googleId])
      : null;

    if (!user) {
      user = await db.queryOne('SELECT * FROM users WHERE email = $1', [email]);
    }

    if (user) {
      // Attach google_id if this email existed before (e.g. from a previous auth method)
      if (googleId && !user.google_id) {
        await db.query('UPDATE users SET google_id = $1 WHERE id = $2', [googleId, user.id]);
      }
    } else {
      // New user — first account on the platform becomes admin
      const { c } = await db.queryOne('SELECT COUNT(*) AS c FROM users');
      const role = Number(c) === 0 ? 'admin' : 'student';

      const id = uuidv4();
      await db.query(
        'INSERT INTO users (id, email, google_id, name, role) VALUES ($1,$2,$3,$4,$5)',
        [id, email, googleId || null, name, role]
      );
      user = await db.queryOne('SELECT * FROM users WHERE id = $1', [id]);
    }

    const token = signToken({ id: user.id, email: user.email, name: user.name, role: user.role });
    res.json({ token, user: { id: user.id, email: user.email, name: user.name, role: user.role } });
  } catch (err) {
    console.error('Google auth error:', err.message);
    res.status(500).json({ error: 'Authentication failed' });
  }
});

// Keep /me for JWT validation (used by every page refresh)
router.get('/me', authenticate, async (req, res) => {
  try {
    const user = await db.queryOne(
      'SELECT id, email, name, role, created_at FROM users WHERE id = $1',
      [req.user.id]
    );
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (err) {
    console.error('Me error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
