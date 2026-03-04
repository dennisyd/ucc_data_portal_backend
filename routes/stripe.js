import { Router }     from 'express';
import Stripe          from 'stripe';
import pool            from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

// Lazy — only instantiate Stripe when a request actually arrives.
// This prevents a crash at startup when STRIPE_SECRET_KEY isn't set yet.
let _stripe = null;
function getStripe() {
  if (!_stripe) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error('STRIPE_SECRET_KEY environment variable is not set.');
    _stripe = new Stripe(key);
  }
  return _stripe;
}

/** Maps plan + interval to the Stripe Price ID from env vars.
 *  interval='month' → MONTHLY, interval='year' → ANNUAL
 */
function getPriceId(plan, interval) {
  const suffix = interval === 'year' ? 'ANNUAL' : 'MONTHLY';
  const key    = `STRIPE_PRICE_${plan.toUpperCase()}_${suffix}`;
  return process.env[key] ?? null;
}

/** Maps Stripe plan name to the role that should be granted. */
const PLAN_TO_ROLE = {
  search: 'search',
  bulk:   'bulk',
  both:   'both',
};

const FRONTEND_URL = process.env.FRONTEND_URL ?? 'https://uccdata.yddconsulting.com';

// ---------------------------------------------------------------------------
// POST /api/stripe/create-checkout-session
// Body: { plan: 'search'|'bulk'|'both', interval: 'month'|'year' }
// ---------------------------------------------------------------------------
router.post('/create-checkout-session', requireAuth, async (req, res) => {
  const { plan, interval } = req.body ?? {};

  if (!['search', 'bulk', 'both'].includes(plan)) {
    return res.status(400).json({ error: 'Invalid plan.' });
  }
  if (!['month', 'year'].includes(interval)) {
    return res.status(400).json({ error: 'Invalid interval.' });
  }

  const priceId = getPriceId(plan, interval);
  if (!priceId) {
    return res.status(500).json({ error: 'Stripe price not configured for this plan.' });
  }

  try {
    const session = await getStripe().checkout.sessions.create({
      mode:        'subscription',
      line_items:  [{ price: priceId, quantity: 1 }],
      success_url: `${FRONTEND_URL}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${FRONTEND_URL}/pricing`,
      metadata: {
        userId:   String(req.user.userId),
        plan,
      },
    });

    return res.json({ url: session.url });
  } catch (err) {
    console.error('[stripe/checkout error]', err.message);
    return res.status(500).json({ error: 'Could not create checkout session.' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/stripe/create-portal-session
// Opens the Stripe Customer Portal for managing subscriptions.
// ---------------------------------------------------------------------------
router.post('/create-portal-session', requireAuth, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT stripe_customer_id FROM users WHERE id = ?',
      [req.user.userId]
    );

    const customerId = rows[0]?.stripe_customer_id;
    if (!customerId) {
      return res.status(400).json({ error: 'No active Stripe subscription found.' });
    }

    const session = await getStripe().billingPortal.sessions.create({
      customer:   customerId,
      return_url: `${FRONTEND_URL}/account`,
    });

    return res.json({ url: session.url });
  } catch (err) {
    console.error('[stripe/portal error]', err.message);
    return res.status(500).json({ error: 'Could not open billing portal.' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/stripe/webhook
// Receives events from Stripe and updates user roles/subscription data.
// NOTE: This route must receive the RAW request body (not parsed JSON).
//       Mount it in server.js BEFORE express.json() middleware.
// ---------------------------------------------------------------------------
router.post('/webhook', async (req, res) => {
  const sig    = req.headers['stripe-signature'];
  const secret = process.env.STRIPE_WEBHOOK_SECRET ?? '';

  let event;
  try {
    event = getStripe().webhooks.constructEvent(req.body, sig, secret);
  } catch (err) {
    console.error('[stripe/webhook] signature verification failed:', err.message);
    return res.status(400).json({ error: 'Webhook signature verification failed.' });
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const session    = event.data.object;
      const userId     = session.metadata?.userId;
      const plan       = session.metadata?.plan;
      const customerId = session.customer;
      const subId      = session.subscription;
      const newRole    = PLAN_TO_ROLE[plan] ?? 'anonymous';

      if (userId) {
        await pool.execute(
          `UPDATE users
           SET role = ?, stripe_customer_id = ?, stripe_subscription_id = ?,
               subscription_plan = ?, subscription_status = 'active'
           WHERE id = ?`,
          [newRole, customerId, subId, plan, userId]
        );
        console.log(`[stripe/webhook] User ${userId} upgraded to role: ${newRole}`);
      }
    }

    if (event.type === 'customer.subscription.deleted') {
      const sub        = event.data.object;
      const customerId = sub.customer;

      await pool.execute(
        `UPDATE users
         SET role = 'anonymous', subscription_status = 'cancelled', stripe_subscription_id = NULL
         WHERE stripe_customer_id = ?`,
        [customerId]
      );
      console.log(`[stripe/webhook] Subscription cancelled for customer: ${customerId}`);
    }

    return res.json({ received: true });
  } catch (err) {
    console.error('[stripe/webhook] handler error:', err.message);
    return res.status(500).json({ error: 'Webhook handler failed.' });
  }
});

export default router;
