import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET ?? 'ucc-dev-secret-change-in-prod';

/**
 * Express middleware — verifies the Bearer JWT and attaches req.user.
 * Returns 401 if the token is missing, malformed, or expired.
 */
export function requireAuth(req, res, next) {
  const header = req.headers.authorization ?? '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Authentication required.' });
  }

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Session expired. Please log in again.' });
  }
}
