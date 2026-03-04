/**
 * export-helpers.js — Shared utilities for building CSV and XLSX output.
 * Extracted so they can be used by both the bulk export and search routes.
 */
import ExcelJS from 'exceljs';

export const BULK_COLUMNS = [
  'ucc', 'filing_date', 'lapse_date', 'debtor',
  'debtor_street', 'debtor_city', 'debtor_state', 'debtor_zip',
  'secured_party', 'official_name', 'official_designation',
  'official_street', 'official_city', 'official_state', 'official_zip',
  'created_at',
];

export const SEARCH_COLUMNS = [
  'ucc', 'filing_date', 'lapse_date', 'debtor',
  'debtor_street', 'debtor_city', 'debtor_state', 'debtor_zip',
  'secured_party',
];

/** Escape a single value for RFC-4180 CSV. */
export function csvCell(value) {
  const str = value == null ? '' : String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

/** Convert an array of row objects to a complete CSV string. */
export function rowsToCsv(rows, columns = BULK_COLUMNS) {
  const lines = [columns.join(',')];
  for (const row of rows) {
    lines.push(columns.map((col) => csvCell(row[col])).join(','));
  }
  return lines.join('\r\n');
}

/** Build a real XLSX workbook buffer from row data using ExcelJS. */
export async function rowsToXlsx(rows, columns = BULK_COLUMNS) {
  const workbook  = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('UCC Filings');

  worksheet.addRow(columns);
  worksheet.getRow(1).font = { bold: true };

  for (const row of rows) {
    worksheet.addRow(columns.map((col) => row[col] ?? ''));
  }

  worksheet.columns.forEach((column) => {
    let maxLength = 10;
    column.eachCell({ includeEmpty: true }, (cell) => {
      const cellLength = cell.value ? String(cell.value).length : 0;
      if (cellLength > maxLength) maxLength = cellLength;
    });
    column.width = Math.min(maxLength + 2, 60);
  });

  return workbook.xlsx.writeBuffer();
}
