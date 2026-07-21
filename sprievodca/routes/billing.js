const express = require('express');
const supabase = require('../lib/supabase');
const stripe = require('../lib/stripe');
const { TIERS, tierByPriceId, tierById } = require('../lib/pricing');
const { requireAuth } = require('../middleware/requireAuth');

const router = express.Router();

async function getOrCreateStripeCustomer(user) {
  const { data: sub } = await supabase
    .from('subscriptions')
    .select('stripe_customer_id')
    .eq('user_id', user.id)
    .maybeSingle();

  if (sub?.stripe_customer_id) return sub.stripe_customer_id;

  const customer = await stripe.customers.create({ email: user.email, metadata: { user_id: user.id } });
  return customer.id;
}

// GET /api/billing/tiers — verejný zoznam plánov (pre paywall/subscribe stránku)
router.get('/tiers', (req, res) => {
  res.json(TIERS.map(({ id, label, tokensIncluded, priceEurMonthly }) => ({ id, label, tokensIncluded, priceEurMonthly })));
});

// GET /api/billing/status — moje predplatné
router.get('/status', requireAuth, async (req, res) => {
  const { data: sub, error } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('user_id', req.user.id)
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ subscription: sub || null });
});

// POST /api/billing/checkout — { tierId } -> Stripe Checkout Session URL
router.post('/checkout', requireAuth, async (req, res) => {
  try {
    const tier = tierById(req.body.tierId);
    if (!tier || !tier.priceId) return res.status(400).json({ error: 'Neznámy alebo nenakonfigurovaný plán.' });

    const customerId = await getOrCreateStripeCustomer(req.user);
    const baseUrl = process.env.APP_BASE_URL || `${req.protocol}://${req.get('host')}`;

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      client_reference_id: req.user.id,
      line_items: [{ price: tier.priceId, quantity: 1 }],
      success_url: `${baseUrl}/?checkout=success`,
      cancel_url: `${baseUrl}/?checkout=cancel`,
      metadata: { user_id: req.user.id, tier_id: tier.id }
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Nepodarilo sa vytvoriť platbu.' });
  }
});

// POST /api/billing/portal — Stripe Customer Portal (zmena/zrušenie predplatného, faktúry)
router.post('/portal', requireAuth, async (req, res) => {
  try {
    const { data: sub } = await supabase
      .from('subscriptions')
      .select('stripe_customer_id')
      .eq('user_id', req.user.id)
      .maybeSingle();

    if (!sub?.stripe_customer_id) return res.status(404).json({ error: 'Zatiaľ nemáš žiadne predplatné.' });

    const baseUrl = process.env.APP_BASE_URL || `${req.protocol}://${req.get('host')}`;
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: sub.stripe_customer_id,
      return_url: `${baseUrl}/`
    });

    res.json({ url: portalSession.url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Nepodarilo sa otvoriť správu predplatného.' });
  }
});

// Stripe subscription objekt má current_period_start/end buď na top-level (staršie API verzie)
// alebo na items.data[0] (novšie) — skús oba, aby sme nezáviseli od presnej API verzie účtu.
function periodBounds(stripeSubscription) {
  const item = stripeSubscription.items?.data?.[0];
  const start = stripeSubscription.current_period_start ?? item?.current_period_start;
  const end = stripeSubscription.current_period_end ?? item?.current_period_end;
  return {
    start: start ? new Date(start * 1000).toISOString() : null,
    end: end ? new Date(end * 1000).toISOString() : null
  };
}

async function upsertSubscriptionFromStripe(stripeSubscription, userId) {
  const priceId = stripeSubscription.items?.data?.[0]?.price?.id;
  const tier = tierByPriceId(priceId);
  const { start, end } = periodBounds(stripeSubscription);

  const payload = {
    user_id: userId,
    stripe_customer_id: stripeSubscription.customer,
    stripe_subscription_id: stripeSubscription.id,
    stripe_price_id: priceId || null,
    plan: tier?.id || null,
    status: stripeSubscription.status,
    current_period_start: start,
    current_period_end: end,
    // Explicitne prepíše prípadné predchádzajúce priradenie cez zľavový kód (source: 'code') —
    // skutočné platené predplatné má vždy prednosť.
    source: 'stripe',
    redemption_code_id: null,
    updated_at: new Date().toISOString()
  };

  const { data: existing } = await supabase
    .from('subscriptions')
    .select('current_period_start')
    .eq('user_id', userId)
    .maybeSingle();

  // Nová fakturačná perióda (nové predplatné alebo obnova) => reset spotreby na plnú kvótu.
  const isNewPeriod = !existing || existing.current_period_start !== payload.current_period_start;
  if (isNewPeriod) {
    payload.tokens_included = tier?.tokensIncluded || 0;
    payload.tokens_used = 0;
  }

  const { error } = await supabase.from('subscriptions').upsert(payload, { onConflict: 'user_id' });
  if (error) throw error;
}

// Volané priamo zo server.js (nie cez router) — potrebuje surové telo requestu (req.rawBody)
// na overenie Stripe podpisu, preto beží mimo bežného express.json() spracovania.
async function handleWebhook(req, res) {
  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.rawBody,
      req.headers['stripe-signature'],
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Stripe webhook signature error:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const userId = session.client_reference_id || session.metadata?.user_id;
        if (userId && session.subscription) {
          const stripeSub = await stripe.subscriptions.retrieve(session.subscription);
          await upsertSubscriptionFromStripe(stripeSub, userId);
        }
        break;
      }
      case 'customer.subscription.updated':
      case 'invoice.payment_succeeded': {
        const obj = event.data.object;
        const subscriptionId = obj.object === 'subscription' ? obj.id : obj.subscription;
        if (subscriptionId) {
          const { data: existing } = await supabase
            .from('subscriptions')
            .select('user_id')
            .eq('stripe_subscription_id', subscriptionId)
            .maybeSingle();
          if (existing) {
            const stripeSub = await stripe.subscriptions.retrieve(subscriptionId);
            await upsertSubscriptionFromStripe(stripeSub, existing.user_id);
          }
        }
        break;
      }
      case 'customer.subscription.deleted': {
        const stripeSub = event.data.object;
        await supabase
          .from('subscriptions')
          .update({ status: 'canceled', updated_at: new Date().toISOString() })
          .eq('stripe_subscription_id', stripeSub.id);
        break;
      }
      default:
        break;
    }
    res.json({ received: true });
  } catch (err) {
    console.error('Stripe webhook handling error:', err);
    res.status(500).json({ error: 'Webhook handling failed' });
  }
}

module.exports = { router, handleWebhook };
