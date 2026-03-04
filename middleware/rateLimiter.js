import rateLimit from 'express-rate-limit';

/**
 * Strict limiter for auth endpoints (login, register).
 * Allows 10 attempts per 15 minutes per IP before blocking.
 * This prevents brute-force and credential-stuffing attacks.
 */
export const authLimiter = rateLimit({
  windowMs:         15 * 60 * 1000, // 15 minutes
  max:              10,
  standardHeaders:  true,
  legacyHeaders:    false,
  message:          { error: 'Too many attempts. Please wait 15 minutes and try again.' },
  skipSuccessfulRequests: true,      // only count failed/errored requests toward the limit
});

/**
 * General API limiter for search and export endpoints.
 * Allows 200 requests per 15 minutes per IP — generous for normal use
 * but blocks runaway scrapers or abusive bulk queries.
 */
export const apiLimiter = rateLimit({
  windowMs:        15 * 60 * 1000,
  max:             200,
  standardHeaders: true,
  legacyHeaders:   false,
  message:         { error: 'Rate limit exceeded. Please slow down your requests.' },
});
