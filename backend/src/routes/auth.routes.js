import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { query } from '../db.js';
import { authenticate } from '../middleware/auth.js';
import { cleanEmail, assertRequired } from '../utils.js';

const router = express.Router();

function signUser(user) {
  return jwt.sign(
    { id: user.id, email: user.email, name: user.name, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
}

router.post('/register', async (req, res, next) => {
  try {
    assertRequired(['name', 'email', 'password'], req.body);
    const { name, password } = req.body;
    const email = cleanEmail(req.body.email);
    const requestedRole = req.body.role || 'student';
    const role = ['student', 'teacher'].includes(requestedRole) ? requestedRole : 'student';

    if (String(password).length < 8) {
      return res.status(400).json({ message: 'Le mot de passe doit contenir au moins 8 caractères.' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const result = await query(
      `INSERT INTO users (name, email, password_hash, role)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, email, role, created_at`,
      [name, email, passwordHash, role]
    );

    const user = result.rows[0];
    res.status(201).json({ user, token: signUser(user) });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ message: 'Cet email est déjà utilisé.' });
    }
    next(error);
  }
});

router.post('/login', async (req, res, next) => {
  try {
    assertRequired(['email', 'password'], req.body);
    const email = cleanEmail(req.body.email);
    const result = await query(
      'SELECT id, name, email, password_hash, role FROM users WHERE email = $1',
      [email]
    );

    const user = result.rows[0];
    if (!user) return res.status(401).json({ message: 'Identifiants invalides.' });

    const ok = await bcrypt.compare(req.body.password, user.password_hash);
    if (!ok) return res.status(401).json({ message: 'Identifiants invalides.' });

    delete user.password_hash;
    res.json({ user, token: signUser(user) });
  } catch (error) {
    next(error);
  }
});

router.get('/me', authenticate, async (req, res, next) => {
  try {
    const result = await query(
      'SELECT id, name, email, role, created_at FROM users WHERE id = $1',
      [req.user.id]
    );
    res.json({ user: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

export default router;
