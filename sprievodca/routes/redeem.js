const express = require('express');
const supabase = require('../lib/supabase');
const { tierById } = require('../lib/pricing');
const { requireAuth } = require('../middleware/requireAuth');

const router = express.Router();
const ACTIVE_STATUSES = ['active', 'trialing'];

// POST /api/redeem — { code } — uplatnenie zľavového/darčekového kódu (žiadna karta, žiadny Stripe)
router.post('/', requireAuth, async (req, res) => {
  try {
    const code = String(req.body.code || '').trim().toUpperCase();
    if (!code) return res.status(400).json({ error: 'Zadaj kód.' });

    const { data: redemption, error: codeError } = await supabase
      .from('redemption_codes')
      .select('*')
      .eq('code', code)
      .maybeSingle();
    if (codeError) throw codeError;

    if (!redemption || !redemption.active) {
      return res.status(404).json({ error: 'Neplatný kód.' });
    }
    if (redemption.expires_at && new Date(redemption.expires_at) < new Date()) {
      return res.status(400).json({ error: 'Platnosť tohto kódu už vypršala.' });
    }
    if (redemption.redemption_count >= redemption.max_redemptions) {
      return res.status(400).json({ error: 'Tento kód je už vyčerpaný.' });
    }

    const { data: alreadyUsed } = await supabase
      .from('redemption_code_uses')
      .select('id')
      .eq('code_id', redemption.id)
      .eq('user_id', req.user.id)
      .maybeSingle();
    if (alreadyUsed) return res.status(400).json({ error: 'Tento kód si už uplatnil.' });

    const tier = tierById(redemption.plan);
    if (!tier) return res.status(500).json({ error: 'Kód odkazuje na neplatný plán, kontaktuj podporu.' });

    const { data: existingSub } = await supabase
      .from('subscriptions')
      .select('status, current_period_end')
      .eq('user_id', req.user.id)
      .maybeSingle();

    const now = new Date();
    const hasActiveAccess =
      existingSub &&
      ACTIVE_STATUSES.includes(existingSub.status) &&
      existingSub.current_period_end &&
      new Date(existingSub.current_period_end) > now;

    if (hasActiveAccess) {
      const until = new Date(existingSub.current_period_end).toLocaleDateString('sk-SK');
      return res
        .status(409)
        .json({ error: `Už máš aktívny prístup do ${until}. Kód môžeš uplatniť až po jeho skončení.` });
    }

    const periodEnd = new Date(now.getTime() + redemption.duration_days * 24 * 60 * 60 * 1000);

    const payload = {
      user_id: req.user.id,
      plan: redemption.plan,
      status: 'active',
      tokens_included: tier.tokensIncluded,
      tokens_used: 0,
      current_period_start: now.toISOString(),
      current_period_end: periodEnd.toISOString(),
      source: 'code',
      redemption_code_id: redemption.id,
      updated_at: now.toISOString()
    };
    // Pri prvom zázname (žiadne predchádzajúce predplatné) nastavíme stripe_customer_id na null;
    // pri existujúcom riadku ho zámerne v payloade necháme vynechaný, aby upsert nezmazal prípadné
    // predchádzajúce prepojenie so Stripe zákazníkom (mohlo by sa hodiť pri budúcom checkoute).
    if (!existingSub) payload.stripe_customer_id = null;

    const { error: upsertError } = await supabase
      .from('subscriptions')
      .upsert(payload, { onConflict: 'user_id' });
    if (upsertError) throw upsertError;

    await Promise.all([
      supabase.from('redemption_code_uses').insert({ code_id: redemption.id, user_id: req.user.id }),
      supabase
        .from('redemption_codes')
        .update({ redemption_count: redemption.redemption_count + 1 })
        .eq('id', redemption.id)
    ]);

    res.json({
      ok: true,
      plan: tier.label,
      tokensIncluded: tier.tokensIncluded,
      periodEnd: periodEnd.toISOString()
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Uplatnenie kódu zlyhalo, skús to prosím znova.' });
  }
});

module.exports = router;
