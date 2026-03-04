/**
 * analytics.js
 *
 * GET /api/analytics/anon-sessions
 *   Admin-only endpoint — returns recent anonymous login records with
 *   geo data so you can see who is browsing as a guest.
 */
import { Router }     from 'express';
import pool           from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

/**
 * Looks up geolocation data for an IP address using the free ip-api.com service.
 * Returns null on any error so a failed lookup never blocks the login response.
 */
export async function geoLookup(ip) {
  // Skip loopback / private addresses — they won't resolve publicly
  if (!ip || ip === '127.0.0.1' || ip === '::1' || ip.startsWith('192.168.') || ip.startsWith('10.')) {
    return null;
  }

  try {
    const controller = new AbortController();
    const timeout    = setTimeout(() => controller.abort(), 3000); // 3-second timeout

    const res = await fetch(
      `http://ip-api.com/json/${ip}?fields=status,country,countryCode,regionName,city,isp,org,timezone`,
      { signal: controller.signal }
    );

    clearTimeout(timeout);

    if (!res.ok) return null;
    const data = await res.json();
    if (data.status !== 'success') return null;

    return {
      country_code: data.countryCode ?? null,
      country:      data.country      ?? null,
      region:       data.regionName   ?? null,
      city:         data.city         ?? null,
      isp:          data.isp          ?? null,
      org:          data.org          ?? null,
      timezone:     data.timezone     ?? null,
    };
  } catch {
    return null; // timeout or network error — silent fail
  }
}

/**
 * Writes one row to anon_sessions. Fire-and-forget — never awaited by the
 * caller so it cannot slow down or break the login response.
 */
export async function logAnonSession(ip, userAgent) {
  try {
    const geo = await geoLookup(ip);

    await pool.execute(
      `INSERT INTO anon_sessions
         (ip, user_agent, country_code, country, region, city, isp, org, timezone)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        ip                     ?? null,
        (userAgent ?? '').slice(0, 500),
        geo?.country_code      ?? null,
        geo?.country           ?? null,
        geo?.region            ?? null,
        geo?.city              ?? null,
        geo?.isp               ?? null,
        geo?.org               ?? null,
        geo?.timezone          ?? null,
      ]
    );
  } catch (err) {
    // Log to console but never surface to the user
    console.error('[analytics] Failed to log anon session:', err.message);
  }
}

// ---------------------------------------------------------------------------
// GET /api/analytics/anon-sessions  (admin only)
// Returns the 200 most recent anonymous login events with geo data.
// ---------------------------------------------------------------------------
router.get('/anon-sessions', requireAuth, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required.' });
  }

  try {
    const [rows] = await pool.execute(
      `SELECT id, ip, logged_at, country_code, country, region, city, isp, org, timezone, user_agent
       FROM   anon_sessions
       ORDER  BY logged_at DESC
       LIMIT  200`
    );
    return res.json(rows);
  } catch (err) {
    console.error('[analytics] Query error:', err.message);
    return res.status(500).json({ error: 'Could not retrieve sessions.' });
  }
});

export default router;
