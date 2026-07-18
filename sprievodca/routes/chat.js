const express = require('express');
const supabase = require('../lib/supabase');
const { embed } = require('../lib/voyage');
const { askMentor } = require('../lib/claude');

const router = express.Router();

const FREE_MESSAGE_LIMIT = Number(process.env.FREE_MESSAGE_LIMIT || 5);
const ACTIVE_STATUSES = ['active', 'trialing'];

async function getOrCreateConversation({ sessionId, userId }) {
  let query = supabase.from('conversations').select('id').order('created_at', { ascending: false }).limit(1);
  query = userId ? query.eq('user_id', userId) : query.eq('session_id', sessionId).is('user_id', null);

  const { data: existing } = await query.maybeSingle();
  if (existing) return existing.id;

  const { data: created, error } = await supabase
    .from('conversations')
    .insert({ session_id: sessionId, user_id: userId || null })
    .select('id')
    .single();

  if (error) throw error;
  return created.id;
}

// Koľko otázok už anonymný návštevník (bez účtu) v tomto prehliadači položil.
async function countFreeMessages(sessionId) {
  const { count, error } = await supabase
    .from('messages')
    .select('id, conversations!inner(session_id, user_id)', { count: 'exact', head: true })
    .eq('role', 'user')
    .eq('conversations.session_id', sessionId)
    .is('conversations.user_id', null);

  if (error) throw error;
  return count || 0;
}

// Overí, či prihlásený používateľ smie dostať odpoveď (aktívne predplatné + zostávajúca kvóta tokenov).
async function checkSubscriptionQuota(userId) {
  const { data: sub, error } = await supabase.from('subscriptions').select('*').eq('user_id', userId).maybeSingle();
  if (error) throw error;

  if (!sub || !ACTIVE_STATUSES.includes(sub.status)) {
    return { allowed: false, reason: 'no_subscription' };
  }
  if (sub.tokens_used >= sub.tokens_included) {
    return { allowed: false, reason: 'quota_exceeded', periodEnd: sub.current_period_end };
  }
  return { allowed: true, remaining: sub.tokens_included - sub.tokens_used };
}

// POST /api/chat — { sessionId, message }
router.post('/', async (req, res) => {
  try {
    const { sessionId, message } = req.body;
    if (!sessionId || !message?.trim()) {
      return res.status(400).json({ error: 'Chýba sessionId alebo message.' });
    }

    const userId = req.user?.id || null;

    if (userId) {
      const quota = await checkSubscriptionQuota(userId);
      if (!quota.allowed) {
        if (quota.reason === 'no_subscription') {
          return res.status(402).json({ error: 'Na pokračovanie potrebuješ aktívne predplatné.', needsSubscription: true });
        }
        return res.status(402).json({
          error: 'Minul sa ti mesačný limit odpovedových tokenov. Obnoví sa na začiatku ďalšieho fakturačného obdobia.',
          quotaExceeded: true,
          periodEnd: quota.periodEnd
        });
      }
    } else {
      const used = await countFreeMessages(sessionId);
      if (used >= FREE_MESSAGE_LIMIT) {
        return res.status(402).json({
          error: `Vyskúšal si už ${FREE_MESSAGE_LIMIT} bezplatných otázok. Zaregistruj sa a predplať si Sprievodcu pre ďalšie odpovede.`,
          needsSubscription: true,
          freeTrialExhausted: true
        });
      }
    }

    const conversationId = await getOrCreateConversation({ sessionId, userId });

    // Posledných pár správ ako história pre kontext rozhovoru
    const { data: pastMessages } = await supabase
      .from('messages')
      .select('role, content')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })
      .limit(20);

    const queryEmbedding = await embed(message, 'query');

    const { data: matches, error: matchError } = await supabase.rpc('match_chunks', {
      query_embedding: queryEmbedding,
      match_count: 6
    });
    if (matchError) throw matchError;

    const { answer, outputTokens } = await askMentor({
      userMessage: message,
      contextChunks: matches || [],
      history: pastMessages || []
    });

    await supabase.from('messages').insert([
      { conversation_id: conversationId, role: 'user', content: message },
      { conversation_id: conversationId, role: 'assistant', content: answer }
    ]);

    let quotaInfo;
    if (userId) {
      const { data: updated } = await supabase.rpc('increment_tokens_used', {
        p_user_id: userId,
        p_amount: outputTokens
      });
      const row = Array.isArray(updated) ? updated[0] : updated;
      if (row) quotaInfo = { remaining: Math.max(row.tokens_included - row.tokens_used, 0), included: row.tokens_included };
    }

    res.json({ answer, quota: quotaInfo });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Nastala chyba, skús to prosím znova.' });
  }
});

module.exports = router;
