/**
 * server.js — UCC Data Portal Express entry point.
 *
 * Usage:
 *   npm start      → production
 *   npm run dev    → auto-restart on file save (Node 18+)
 */
import express      from 'express';
import authRouter   from './routes/auth.js';
import exportRouter from './routes/export.js';
import searchRouter from './routes/search.js';
import statesRouter from './routes/states.js';
import stripeRouter from './routes/stripe.js';

const app  = express();
const PORT = process.env.PORT ?? 8080;

// ---------------------------------------------------------------------------
// CORS
// ---------------------------------------------------------------------------
const ALLOWED_ORIGINS = [
  'https://uccdata.yddconsulting.com',
  'http://uccdata.yddconsulting.com',
  'https://ucc-data-portal-frontend.vercel.app',
  'http://localhost:5173',
  'http://localhost:4173',
];

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.set('Access-Control-Allow-Origin', origin);
  }
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ---------------------------------------------------------------------------
// Body parsing
// The Stripe webhook MUST receive the raw body before express.json() parses it.
// ---------------------------------------------------------------------------
app.use('/api/stripe/webhook', express.raw({ type: 'application/json' }));
app.use(express.json());

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
app.use('/api/auth',   authRouter);
app.use('/api/search', searchRouter);
app.use('/api/stripe', stripeRouter);
app.use('/backend',    exportRouter);
app.use('/backend',    statesRouter);

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`\nUCC backend running → http://localhost:${PORT}`);
  console.log(`  POST /api/auth/login`);
  console.log(`  POST /api/search`);
  console.log(`  GET  /backend/export.php`);
  console.log(`  GET  /backend/states`);
  console.log(`  POST /api/stripe/create-checkout-session`);
  console.log(`  POST /api/stripe/webhook`);
  console.log(`Environment → ${process.env.NODE_ENV ?? 'development'}\n`);
});
