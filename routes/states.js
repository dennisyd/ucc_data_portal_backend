import { Router } from 'express';
import pool        from '../db.js';

const router = Router();

/**
 * GET /backend/states
 * Public endpoint — returns all rows from States_Metadata ordered by total_records DESC.
 * Used by the login page to show available state data before signing in.
 */
router.get('/states', async (req, res) => {
  try {
    // Fetch metadata and flag which states are actively scraped
    // by checking against the States table (contains only scraped state abbreviations)
    const [rows] = await pool.execute(
      `SELECT
         sm.debtor_state,
         sm.total_records,
         sm.last_created_at,
         CASE WHEN s.State IS NOT NULL THEN 1 ELSE 0 END AS is_scraped
       FROM States_Metadata sm
       LEFT JOIN States s ON sm.debtor_state = s.state
       ORDER BY sm.total_records DESC`
    );

    const formatted = rows
      .filter((row) => row.debtor_state != null)
      .map((row) => ({
        state_abbr:      row.debtor_state,
        total_records:   Number(row.total_records),
        last_created_at: row.last_created_at
          ? new Date(row.last_created_at).toISOString().slice(0, 10)
          : null,
        is_scraped:      row.is_scraped === 1,
      }));

    return res.json(formatted);
  } catch (err) {
    console.error('[states error]', err.message);
    return res.status(500).json({ error: 'Could not load state data.' });
  }
});

export default router;
