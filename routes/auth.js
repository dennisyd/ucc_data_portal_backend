import { Router } from 'express';
import jwt         from 'jsonwebtoken';
import pool        from '../db.js';

const router     = Router();
const JWT_SECRET = process.env.JWT_SECRET ?? 'ucc-dev-secret-change-in-prod';

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

    const user  = rows[0];
    const token = jwt.sign(
      { userId: user.id, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    return res.json({
      token,
      user: { username: user.username, role: user.role },
    });
  } catch (err) {
    console.error('[auth/login error]', err.message);
    return res.status(500).json({ error: 'Login failed. Please try again.' });
  }
});

export default router;
