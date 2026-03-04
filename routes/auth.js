import { Router }          from 'express';
import jwt                 from 'jsonwebtoken';
import bcrypt              from 'bcrypt';
import pool                from '../db.js';
import { logAnonSession }  from './analytics.js';

const router     = Router();
const JWT_SECRET = process.env.JWT_SECRET ?? 'ucc-dev-secret-change-in-prod';
const SALT_ROUNDS = 12; // bcrypt work factor — ~300 ms on modern hardware, plenty fast for login

/** Mint a signed JWT for a user row. */
function signToken(user) {
  return jwt.sign(
    { userId: user.id, username: user.username, role: user.role },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

/**
 * Returns true if the string looks like a bcrypt hash.
 * bcrypt hashes always start with $2b$ or $2a$.
 */
function isBcryptHash(str) {
  return typeof str === 'string' && (str.startsWith('$2b$') || str.startsWith('$2a$'));
}

// ---------------------------------------------------------------------------
// POST /api/auth/login
// ---------------------------------------------------------------------------
router.post('/login', async (req, res) => {
  const { username, password } = req.body ?? {};

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required.' });
  }

  try {
    const [rows] = await pool.execute(
      'SELECT id, username, password, role FROM users WHERE username = ?',
      [username.trim()]
    );

    if (rows.length === 0) {
      // Constant-time response to prevent username enumeration
      await bcrypt.compare(password, '$2b$12$invalidhashfortimingprotection000000000000000000000');
      return res.status(401).json({ error: 'Invalid username or password.' });
    }

    const user           = rows[0];
    const storedPassword = user.password;
    let   passwordValid  = false;

    if (isBcryptHash(storedPassword)) {
      // Modern path: compare against bcrypt hash
      passwordValid = await bcrypt.compare(password, storedPassword);
    } else {
      // Legacy path: plain-text comparison for pre-existing accounts
      passwordValid = password === storedPassword;

      // Silently upgrade to bcrypt on successful login
      if (passwordValid) {
        const hashed = await bcrypt.hash(password, SALT_ROUNDS);
        await pool.execute(
          'UPDATE users SET password = ? WHERE id = ?',
          [hashed, user.id]
        );
        console.log(`[auth/login] Upgraded password to bcrypt for user: ${user.username}`);
      }
    }

    if (!passwordValid) {
      return res.status(401).json({ error: 'Invalid username or password.' });
    }

    const token = signToken(user);

    // Fire-and-forget: log anonymous sessions for visitor intelligence
    if (user.role === 'anonymous') {
      const ip        = req.headers['x-forwarded-for']?.split(',')[0].trim() ?? req.ip;
      const userAgent = req.headers['user-agent'] ?? '';
      logAnonSession(ip, userAgent); // intentionally not awaited
    }

    return res.json({
      token,
      user: { username: user.username, role: user.role },
    });
  } catch (err) {
    console.error('[auth/login error]', err.message);
    return res.status(500).json({ error: 'Login failed. Please try again.' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/auth/register
// ---------------------------------------------------------------------------
router.post('/register', async (req, res) => {
  const { username, password, email } = req.body ?? {};

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
    // Check if username already taken
    const [existing] = await pool.execute(
      'SELECT id FROM users WHERE username = ?',
      [username.trim()]
    );
    if (existing.length > 0) {
      return res.status(409).json({ error: 'Username is already taken.' });
    }

    // Hash password before storing
    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

    const [result] = await pool.execute(
      'INSERT INTO users (username, password, email, role) VALUES (?, ?, ?, ?)',
      [username.trim(), hashedPassword, email?.trim() ?? null, 'anonymous']
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
