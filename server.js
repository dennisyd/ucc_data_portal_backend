/**
 * UCC Data Portal – Express Backend
 *
 * Replaces the PHP export.php stack entirely.
 * Connects to DreamHost MySQL and serves UCC filings as CSV / JSON / XLSX.
 *
 * Usage:
 *   npm start          → production
 *   npm run dev        → auto-restart on file save (Node 18+)
 *
 * Runs on port 8080 to match the Vite proxy in frontend/vite.config.ts.
 */

import express from 'express';
import mysql from 'mysql2/promise';
import ExcelJS from 'exceljs';
import config from './config.js';

const app = express();

// Render assigns its own PORT at runtime; fall back to 8080 for local dev.
const PORT = process.env.PORT ?? 8080;

// ---------------------------------------------------------------------------
// CORS — allow the production frontend domain and local Vite dev server.
// Add any additional origins to the ALLOWED_ORIGINS list as needed.
// ---------------------------------------------------------------------------
const ALLOWED_ORIGINS = [
  'https://uccdata.yddconsulting.com',
  'http://uccdata.yddconsulting.com',   // HTTP during SSL propagation
  'https://ucc-data-portal-frontend.vercel.app',
  'http://localhost:5173',
  'http://localhost:4173',
];

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.set('Access-Control-Allow-Origin', origin);
  }
  res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ---------------------------------------------------------------------------
// Column list — defines the shape of every exported file
// ---------------------------------------------------------------------------
const COLUMNS = [
  'ucc',
  'filing_date',
  'lapse_date',
  'debtor',
  'debtor_street',
  'debtor_city',
  'debtor_state',
  'debtor_zip',
  'secured_party',
  'official_name',
  'official_designation',
  'official_street',
  'official_city',
  'official_state',
  'official_zip',
  'created_at',
];

// ---------------------------------------------------------------------------
// Format helpers
// ---------------------------------------------------------------------------

/**
 * Escape a single value for RFC-4180 CSV.
 * Wraps values in double-quotes when they contain commas, quotes, or newlines.
 *
 * @param {unknown} value
 * @returns {string}
 */
function csvCell(value) {
  const str = value == null ? '' : String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

/**
 * Convert an array of row objects to a complete CSV string (header + data).
 *
 * @param {Record<string, unknown>[]} rows
 * @returns {string}
 */
function rowsToCsv(rows) {
  const lines = [COLUMNS.join(',')];
  for (const row of rows) {
    lines.push(COLUMNS.map((col) => csvCell(row[col])).join(','));
  }
  return lines.join('\r\n');
}

/**
 * Build a real XLSX workbook buffer from row data using ExcelJS.
 * Includes a bold header row and auto-width columns.
 *
 * @param {Record<string, unknown>[]} rows
 * @returns {Promise<Buffer>}
 */
async function rowsToXlsx(rows) {
  const workbook  = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('UCC Filings');

  // Bold header row
  worksheet.addRow(COLUMNS);
  worksheet.getRow(1).font = { bold: true };

  // Data rows
  for (const row of rows) {
    worksheet.addRow(COLUMNS.map((col) => row[col] ?? ''));
  }

  // Auto-size each column based on the longest value in it
  worksheet.columns.forEach((column) => {
    let maxLength = 10;
    column.eachCell({ includeEmpty: true }, (cell) => {
      const cellLength = cell.value ? String(cell.value).length : 0;
      if (cellLength > maxLength) maxLength = cellLength;
    });
    column.width = Math.min(maxLength + 2, 60); // cap at 60 chars wide
  });

  return workbook.xlsx.writeBuffer();
}

// ---------------------------------------------------------------------------
// Route: GET /backend/export.php
//
// Keeps the same URL path as the original PHP file so the frontend and
// Vite proxy config require no changes.
//
// Query params:
//   date   – YYYY-MM-DD  (optional; omit for all dates)
//   state  – 2-letter abbreviation or ALL  (default: ALL)
//   format – csv | json | xlsx             (default: csv)
// ---------------------------------------------------------------------------
app.get('/backend/export.php', async (req, res) => {

  // -- Parse and validate inputs --------------------------------------------
  const date   = String(req.query.date   ?? '').trim();
  const state  = (String(req.query.state ?? 'ALL').trim().toUpperCase()) || 'ALL';
  const format = String(req.query.format ?? 'csv').trim().toLowerCase();

  // limit: optional positive integer — caps the number of rows returned
  const limitRaw = req.query.limit !== undefined ? parseInt(String(req.query.limit), 10) : null;
  const limit    = limitRaw !== null && Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : null;

  // random: when true, rows are returned in random order (used for anon sampling)
  const random = String(req.query.random ?? '').toLowerCase() === 'true';

  if (!['csv', 'json', 'jsonl', 'xlsx'].includes(format)) {
    return res.status(400).json({ error: 'Invalid format. Use csv, xlsx, json, or jsonl.' });
  }

  if (date !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'Invalid date. Use YYYY-MM-DD.' });
  }

  if (state !== 'ALL' && !/^[A-Z]{2}$/.test(state)) {
    return res.status(400).json({ error: 'Invalid state. Use two-letter abbreviation or ALL.' });
  }

  // -- Build the download filename base ------------------------------------
  const datePart  = date  !== ''    ? date                  : 'all';
  const statePart = state !== 'ALL' ? state.toLowerCase()   : 'all';
  const basename  = `ucc_export_${datePart}_${statePart}`;

  // -- Query the database --------------------------------------------------
  let connection;
  try {
    connection = await mysql.createConnection({
      host:     config.host,
      database: config.database,
      user:     config.user,
      password: config.password,
      charset:  'utf8mb4',
    });

    // Build parameterised query to prevent SQL injection
    let sql = `SELECT ${COLUMNS.join(', ')} FROM ucc_filings`;
    const conditions = [];
    const params     = [];

    if (date !== '') {
      // Return all records created after the selected date
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

    // Random order for anon sampling; otherwise most-recent first
    sql += random ? ' ORDER BY RAND()' : ' ORDER BY filing_date DESC, created_at DESC';

    if (limit !== null) {
      sql += ' LIMIT ?';
      params.push(limit);
    }

    const [rows] = await connection.execute(sql, params);

    // -- Send the response in the requested format -------------------------
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');

    if (format === 'json') {
      res.set('Content-Disposition', `attachment; filename="${basename}.json"`);
      return res.json(rows);
    }

    if (format === 'jsonl') {
      // JSON Lines: one JSON object per line, easy to stream and process
      res.set('Content-Type', 'application/jsonl; charset=utf-8');
      res.set('Content-Disposition', `attachment; filename="${basename}.jsonl"`);
      return res.send(rows.map((row) => JSON.stringify(row)).join('\n'));
    }

    if (format === 'csv') {
      res.set('Content-Type', 'text/csv; charset=utf-8');
      res.set('Content-Disposition', `attachment; filename="${basename}.csv"`);
      return res.send(rowsToCsv(rows));
    }

    // xlsx — real XLSX file generated by ExcelJS with a bold header row
    const xlsxBuffer = await rowsToXlsx(rows);
    res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.set('Content-Disposition', `attachment; filename="${basename}.xlsx"`);
    return res.send(xlsxBuffer);

  } catch (err) {
    // Log the real error server-side; return a safe message to the client
    console.error('[export error]', err.message);
    return res.status(500).json({ error: 'Export failed. Please try again later.' });

  } finally {
    // Always close the connection, even if an error occurred
    if (connection) await connection.end();
  }
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`\nUCC backend running → http://localhost:${PORT}`);
  console.log(`Export endpoint    → http://localhost:${PORT}/backend/export.php`);
  console.log(`Environment        → ${process.env.NODE_ENV ?? 'development'}\n`);
});

