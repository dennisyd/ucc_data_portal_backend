import { Router }                                  from 'express';
import pool                                         from '../db.js';
import { requireAuth }                              from '../middleware/auth.js';
import { BULK_COLUMNS, rowsToCsv, rowsToXlsx }     from '../utils/export-helpers.js';

const router = Router();

/** Roles permitted to use bulk export. */
const BULK_ROLES = new Set(['bulk', 'both', 'admin']);

/**
 * GET /backend/export.php
 * Protected — requires a valid JWT with a bulk-capable role.
 *
 * Query params:
 *   date   – YYYY-MM-DD  (optional)
 *   state  – 2-letter code or ALL  (default: ALL)
 *   format – csv | json | jsonl | xlsx  (default: csv)
 */
router.get('/export.php', requireAuth, async (req, res) => {
  const { role } = req.user;

  if (!BULK_ROLES.has(role)) {
    return res.status(403).json({ error: 'Bulk export requires a Bulk Data or Bundle subscription.' });
  }

  const date   = String(req.query.date   ?? '').trim();
  const state  = (String(req.query.state ?? 'ALL').trim().toUpperCase()) || 'ALL';
  const format = String(req.query.format ?? 'csv').trim().toLowerCase();
  const limitRaw = req.query.limit !== undefined ? parseInt(String(req.query.limit), 10) : null;
  const limit    = limitRaw !== null && Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : null;
  const random   = String(req.query.random ?? '').toLowerCase() === 'true';

  if (!['csv', 'json', 'jsonl', 'xlsx'].includes(format)) {
    return res.status(400).json({ error: 'Invalid format. Use csv, xlsx, json, or jsonl.' });
  }
  if (date !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'Invalid date. Use YYYY-MM-DD.' });
  }
  if (state !== 'ALL' && !/^[A-Z]{2}$/.test(state)) {
    return res.status(400).json({ error: 'Invalid state. Use two-letter abbreviation or ALL.' });
  }

  const datePart  = date  !== ''    ? date               : 'all';
  const statePart = state !== 'ALL' ? state.toLowerCase() : 'all';
  const basename  = `ucc_export_${datePart}_${statePart}`;

  try {
    let sql = `SELECT ${BULK_COLUMNS.join(', ')} FROM ucc_filings`;
    const conditions = [];
    const params     = [];

    if (date !== '') {
      conditions.push('created_at > ?');
      params.push(date);
    }
    if (state !== 'ALL') {
      conditions.push('debtor_state = ?');
      params.push(state);
    }
    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    sql += ' ORDER BY filing_date DESC, created_at DESC';

    if (random && limit !== null) {
      const poolSize = Math.min(limit * 20, 5000);
      sql += ` LIMIT ${poolSize}`;
    } else if (limit !== null) {
      sql += ` LIMIT ${limit}`;
    }

    const [rawRows] = await pool.execute(sql, params);

    let rows = rawRows;
    if (random && limit !== null) {
      const pool2 = Array.from(rawRows);
      for (let i = pool2.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool2[i], pool2[j]] = [pool2[j], pool2[i]];
      }
      rows = pool2.slice(0, limit);
    }

    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');

    if (format === 'json') {
      res.set('Content-Disposition', `attachment; filename="${basename}.json"`);
      return res.json(rows);
    }
    if (format === 'jsonl') {
      res.set('Content-Type', 'application/jsonl; charset=utf-8');
      res.set('Content-Disposition', `attachment; filename="${basename}.jsonl"`);
      return res.send(rows.map((row) => JSON.stringify(row)).join('\n'));
    }
    if (format === 'csv') {
      res.set('Content-Type', 'text/csv; charset=utf-8');
      res.set('Content-Disposition', `attachment; filename="${basename}.csv"`);
      return res.send(rowsToCsv(rows));
    }

    const xlsxBuffer = await rowsToXlsx(rows);
    res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.set('Content-Disposition', `attachment; filename="${basename}.xlsx"`);
    return res.send(xlsxBuffer);

  } catch (err) {
    console.error('[export error]', err.message);
    return res.status(500).json({ error: 'Export failed. Please try again later.' });
  }
});

export default router;
