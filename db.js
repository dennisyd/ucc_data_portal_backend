/**
 * db.js — Shared MySQL connection pool.
 *
 * Using a pool avoids creating a new TCP connection on every request,
 * which is especially important on Render's free tier where connection
 * setup latency is noticeable.
 */
import mysql  from 'mysql2/promise';
import config from './config.js';

const pool = mysql.createPool({
  host:               config.host,
  database:           config.database,
  user:               config.user,
  password:           config.password,
  charset:            'utf8mb4',
  waitForConnections: true,
  connectionLimit:    10,
  queueLimit:         0,
});

export default pool;
