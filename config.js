/**
 * Database configuration for the DreamHost MySQL connection.
 *
 * In production (Render), these values are supplied via environment variables
 * set in the Render dashboard. Locally, create backend/.env and set them there,
 * or fall back to the hardcoded defaults below for quick development.
 *
 * Required env vars:
 *   DB_HOST      – MySQL hostname
 *   DB_NAME      – Database name
 *   DB_USER      – MySQL username
 *   DB_PASSWORD  – MySQL password
 */
export default {
  host:     process.env.DB_HOST     ?? 'mysql.pythonmoney.com',
  database: process.env.DB_NAME     ?? 'ucc_records',
  user:     process.env.DB_USER     ?? 'kelman',
  password: process.env.DB_PASSWORD ?? 'kelman2001!',
};

