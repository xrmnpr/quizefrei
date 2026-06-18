const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db/database');
const { signToken, verifyToken, authenticate } = require('../middleware/auth');

const router = express.Router();

// Parse the base64 X-MS-CLIENT-PRINCIPAL header Azure injects after Easy Auth
function parsePrincipal(req) {
  const header = req.headers['x-ms-client-principal'];
  if (!header) return null;
  const data = JSON.parse(Buffer.from(header, 'base64').toString('utf8'));
  const claims = Array.isArray(data.claims) ? data.claims : [];
  const get = (...types) => {
    for (const t of types) {
      const c = claims.find(x => x.typ === t);
      if (c?.val) return c.val;
    }
    return null;
  };
  return {
    googleId: get(
      'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier',
      'sub'
    ),
    email: (
      get(
        'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress',
        'email', 'emails', 'preferred_username'
      ) || data.user_id || ''
    ).toLowerCase(),
    name: get('name', 'display_name')
  };
}

// ---------------------------------------------------------------------------
// POST /api/auth/google
// Called right after the Azure Easy Auth Google session is established.
// • Existing user  → issues our JWT immediately.
// • New user       → returns needs_registration + a short-lived token so the
//                    frontend can show the role-picker without a second OAuth.
// ---------------------------------------------------------------------------
router.post('/google', async (req, res) => {
  const principal = parsePrincipal(req);
  if (!principal) {
    return res.status(401).json({ error: 'No Azure auth session. Visit /.auth/login/google first.' });
  }

  const { googleId, email, name } = principal;
  if (!email) return res.status(400).json({ error: 'Google account did not provide an email address' });

  try {
    // Look up by googleId first, fall back to email
    let user = googleId
      ? await db.queryOne('SELECT * FROM users WHERE google_id = $1', [googleId])
      : null;
    if (!user) user = await db.queryOne('SELECT * FROM users WHERE email = $1', [email]);

    if (user) {
      if (googleId && !user.google_id) {
        await db.query('UPDATE users SET google_id = $1 WHERE id = $2', [googleId, user.id]);
      }
      const token = signToken({ id: user.id, email: user.email, name: user.name, role: user.role });
      return res.json({ token, user: { id: user.id, email: user.email, name: user.name, role: user.role } });
    }

    // New user — issue a short-lived registration token (10 min) so the
    // frontend can present the role picker and then call /complete-registration.
    const registrationToken = signToken({ type: 'registration', googleId, email, name }, '10m');
    res.json({ needs_registration: true, registration_token: registrationToken });
  } catch (err) {
    console.error('Google auth error:', err.message);
    res.status(500).json({ error: 'Authentication failed' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/auth/complete-registration
// Finalises account creation after the user picks a role.
// ---------------------------------------------------------------------------
router.post('/complete-registration', async (req, res) => {
  const { registration_token, role } = req.body;
  if (!registration_token) return res.status(400).json({ error: 'registration_token required' });
  if (!['student', 'teacher'].includes(role)) return res.status(400).json({ error: 'Role must be student or teacher' });

  try {
    const payload = verifyToken(registration_token);
    if (payload.type !== 'registration') return res.status(400).json({ error: 'Invalid token type' });

    const { googleId, email, name } = payload;

    // Guard against race conditions
    let user = googleId
      ? await db.queryOne('SELECT * FROM users WHERE google_id = $1', [googleId])
      : null;
    if (!user) user = await db.queryOne('SELECT * FROM users WHERE email = $1', [email]);

    if (!user) {
      // First-ever user on the platform becomes admin regardless of chosen role
      const { c } = await db.queryOne('SELECT COUNT(*) AS c FROM users');
      const finalRole = Number(c) === 0 ? 'admin' : role;

      const id = uuidv4();
      await db.query(
        'INSERT INTO users (id, email, google_id, name, role) VALUES ($1,$2,$3,$4,$5)',
        [id, email, googleId || null, name, finalRole]
      );
      user = await db.queryOne('SELECT * FROM users WHERE id = $1', [id]);
    }

    const token = signToken({ id: user.id, email: user.email, name: user.name, role: user.role });
    res.json({ token, user: { id: user.id, email: user.email, name: user.name, role: user.role } });
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Registration session expired. Please sign in again.' });
    }
    console.error('Complete registration error:', err.message);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/auth/me  — validate an existing JWT
// ---------------------------------------------------------------------------
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
