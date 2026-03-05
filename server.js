/**
 * server.js — UCC Data Portal Express entry point.
 *
 * Security layers applied here (outermost to innermost):
 *   1. Helmet      — sets secure HTTP response headers
 *   2. CORS        — HTTPS-only allowed origins in production
 *   3. Rate limits — brute-force protection on auth; general limit on API
 *   4. Body parser — 50 kb max to prevent large-payload DoS
 *   5. Routes      — business logic
 */
import express      from 'express';
import helmet       from 'helmet';
import authRouter   from './routes/auth.js';
import exportRouter from './routes/export.js';
import searchRouter from './routes/search.js';
import statesRouter from './routes/states.js';
import stripeRouter from './routes/stripe.js';
import analyticsRouter from './routes/analytics.js';
import { authLimiter, apiLimiter } from './middleware/rateLimiter.js';

const app  = express();
const PORT = process.env.PORT ?? 8080;
const isProd = process.env.NODE_ENV === 'production';

// Trust the first hop from Render's load balancer so that express-rate-limit
// and req.ip correctly read the real client IP from X-Forwarded-For.
app.set('trust proxy', 1);

// ---------------------------------------------------------------------------
// 1. Security headers via Helmet
//    Sets X-Frame-Options, X-Content-Type-Options, Strict-Transport-Security,
//    X-DNS-Prefetch-Control, Referrer-Policy and more in one call.
// ---------------------------------------------------------------------------
app.use(helmet({
  // Allow Stripe.js and our own CDN assets to load in the browser
  contentSecurityPolicy: false,
}));

// ---------------------------------------------------------------------------
// 2. CORS — only HTTPS origins in production; localhost allowed in dev
// ---------------------------------------------------------------------------
const ALLOWED_ORIGINS = isProd
  ? [
      'https://uccdata.yddconsulting.com',
      'https://ucc-data-portal-frontend.vercel.app',
    ]
  : [
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
// 3. Body parsing
//    Stripe webhook MUST receive raw bytes — mount it before express.json().
//    50 kb limit on JSON body to prevent large-payload abuse.
// ---------------------------------------------------------------------------
app.use('/api/stripe/webhook', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '50kb' }));

// ---------------------------------------------------------------------------
// 4. Routes (with rate limiters applied per-router)
// ---------------------------------------------------------------------------
app.use('/api/auth',       authLimiter, authRouter);
app.use('/api/search',    apiLimiter,  searchRouter);
app.use('/api/stripe',    apiLimiter,  stripeRouter);
app.use('/api/analytics', apiLimiter,  analyticsRouter);
app.use('/backend',       apiLimiter,  exportRouter);
app.use('/backend',                    statesRouter);

// ---------------------------------------------------------------------------
// 5. Start
// ---------------------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`\nUCC backend running → http://localhost:${PORT}`);
  console.log(`  POST /api/auth/login`);
  console.log(`  POST /api/auth/register`);
  console.log(`  POST /api/search`);
  console.log(`  GET  /backend/export.php`);
  console.log(`  GET  /backend/states`);
  console.log(`  POST /api/stripe/create-checkout-session`);
  console.log(`  POST /api/stripe/webhook`);
  console.log(`Environment → ${process.env.NODE_ENV ?? 'development'}`);
  console.log(`Production mode → ${isProd}\n`);
});
