import { Router }      from 'express';
import pool             from '../db.js';
import { requireAuth }  from '../middleware/auth.js';
import { SEARCH_COLUMNS, rowsToCsv } from '../utils/export-helpers.js';

const router = Router();

/** Per-role record limits for search results. */
const ROLE_LIMITS = {
  anonymous: 3,
  search:    500,
  both:      500,
  admin:     null,   // no cap — practical SQL limit applied below
};

/** Roles that may NOT use search at all. */
const SEARCH_BLOCKED = new Set(['bulk']);

/**
 * Builds a parameterized WHERE clause and ORDER/LIMIT from the request filters.
 * LIMIT is interpolated (not a placeholder) because mysql2 prepared statements
 * do not support LIMIT as a bound parameter.
 */
function buildSearchQuery(filters, role) {
  const conditions = [];
  const params     = [];

  if (filters.debtor && filters.debtor.trim().length >= 3) {
    conditions.push('debtor LIKE ?');
    params.push(`%${filters.debtor.trim()}%`);
  }
  if (filters.secured_party && filters.secured_party.trim().length >= 3) {
    conditions.push('secured_party LIKE ?');
    params.push(`%${filters.secured_party.trim()}%`);
  }
  if (filters.state && filters.state !== 'ALL') {
    conditions.push('debtor_state = ?');
    params.push(filters.state.toUpperCase());
  }
  if (filters.date_from) {
    conditions.push('filing_date >= ?');
    params.push(filters.date_from);
  }
  if (filters.date_to) {
    conditions.push('filing_date <= ?');
    params.push(filters.date_to);
  }
  if (filters.active_only) {
    conditions.push('lapse_date > CURRENT_DATE');
  }

  if (conditions.length === 0) {
    throw new Error('At least one search filter is required.');
  }

  // Use `in` check so admin's explicit `null` value isn't swallowed by `?? 3`
  const roleLimit = role in ROLE_LIMITS ? ROLE_LIMITS[role] : 3;
  const sqlLimit  = roleLimit === null ? 100000 : roleLimit;

  const sql =
    `SELECT ${SEARCH_COLUMNS.join(', ')} FROM ucc_filings` +
    ` WHERE ${conditions.join(' AND ')}` +
    ` ORDER BY filing_date DESC` +
    ` LIMIT ${sqlLimit}`;

  return { sql, params, limit: sqlLimit };
}

/**
 * POST /api/search
 * Body: { debtor, secured_party, state, date_from, date_to, active_only }
 * Returns: { total_returned, limit, capped, results }
 */
router.post('/', requireAuth, async (req, res) => {
  const { role } = req.user;

  if (SEARCH_BLOCKED.has(role)) {
    return res.status(403).json({
      error: 'Search requires a Debtor Search or Bundle subscription.',
    });
  }

  const filters = {
    debtor:        req.body.debtor        ?? '',
    secured_party: req.body.secured_party ?? '',
    state:         req.body.state         ?? '',
    date_from:     req.body.date_from     ?? '',
    date_to:       req.body.date_to       ?? '',
    active_only:   req.body.active_only   ?? false,
  };

  // Validate minimum characters for text fields
  const textTooShort =
    (filters.debtor        && filters.debtor.trim().length > 0 && filters.debtor.trim().length < 3) ||
    (filters.secured_party && filters.secured_party.trim().length > 0 && filters.secured_party.trim().length < 3);

  if (textTooShort) {
    return res.status(400).json({ error: 'Text search fields require at least 3 characters.' });
  }

  let query;
  try {
    query = buildSearchQuery(filters, role);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  try {
    const [rows] = await pool.execute(query.sql, query.params);
    const capped  = rows.length === query.limit;

    return res.json({
      total_returned: rows.length,
      limit:          query.limit,
      capped,
      results:        rows,
    });
  } catch (err) {
    console.error('[search error]', err.message);
    return res.status(500).json({ error: 'Search failed. Please try again.' });
  }
});

export default router;
