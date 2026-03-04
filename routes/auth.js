import { Router } from 'express';
import jwt         from 'jsonwebtoken';
import pool        from '../db.js';

const router     = Router();
const JWT_SECRET = process.env.JWT_SECRET ?? 'ucc-dev-secret-change-in-prod';

/** Mint a JWT for a user row */
function signToken(user) {
  return jwt.sign(
    { userId: user.id, username: user.username, role: user.role },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

/**
 * POST /api/auth/login
 * Body: { username, password }
 * Returns: { token, user: { username, role } }
 */
router.post('/login', async (req, res) => {
  const { username, password } = req.body ?? {};

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required.' });
  }

  try {
    const [rows] = await pool.execute(
      'SELECT id, username, role, stripe_customer_id FROM users WHERE username = ? AND password = ?',
      [username.trim(), password]
    );

    if (rows.length === 0) {
      return res.status(401).json({ error: 'Invalid username or password.' });
    }

    const token = signToken(rows[0]);

    return res.json({
      token,
      user: { username: rows[0].username, role: rows[0].role },
    });
  } catch (err) {
    console.error('[auth/login error]', err.message);
    return res.status(500).json({ error: 'Login failed. Please try again.' });
  }
});

/**
 * POST /api/auth/register
 * Body: { username, password, email? }
 * Creates a new user with role='anonymous', returns a JWT (auto-login).
 */
router.post('/register', async (req, res) => {
  const { username, password, email } = req.body ?? {};

  // Basic validation
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required.' });
  }
  if (username.trim().length < 3) {
    return res.status(400).json({ error: 'Username must be at least 3 characters.' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  }

  try {
    // Check if username is already taken
    const [existing] = await pool.execute(
      'SELECT id FROM users WHERE username = ?',
      [username.trim()]
    );
    if (existing.length > 0) {
      return res.status(409).json({ error: 'Username is already taken.' });
    }

    // Insert new user with anonymous role
    const [result] = await pool.execute(
      'INSERT INTO users (username, password, email, role) VALUES (?, ?, ?, ?)',
      [username.trim(), password, email?.trim() ?? null, 'anonymous']
    );

    const newUser = { id: result.insertId, username: username.trim(), role: 'anonymous' };
    const token   = signToken(newUser);

    console.log(`[auth/register] New user registered: ${newUser.username}`);

    return res.status(201).json({
      token,
      user: { username: newUser.username, role: newUser.role },
    });
  } catch (err) {
    console.error('[auth/register error]', err.message);
    return res.status(500).json({ error: 'Registration failed. Please try again.' });
  }
});

export default router;
