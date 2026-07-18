const express = require('express');
const supabase = require('../lib/supabase');
const { embed } = require('../lib/voyage');
const { askMentor } = require('../lib/claude');

const router = express.Router();

async function getOrCreateConversation(sessionId) {
  const { data: existing } = await supabase
    .from('conversations')
    .select('id')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing) return existing.id;

  const { data: created, error } = await supabase
    .from('conversations')
    .insert({ session_id: sessionId })
    .select('id')
    .single();

  if (error) throw error;
  return created.id;
}

// POST /api/chat — { sessionId, message }
router.post('/', async (req, res) => {
  try {
    const { sessionId, message } = req.body;
    if (!sessionId || !message?.trim()) {
      return res.status(400).json({ error: 'Chýba sessionId alebo message.' });
    }

    const conversationId = await getOrCreateConversation(sessionId);

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

    const answer = await askMentor({
      userMessage: message,
      contextChunks: matches || [],
      history: pastMessages || []
    });

    await supabase.from('messages').insert([
      { conversation_id: conversationId, role: 'user', content: message },
      { conversation_id: conversationId, role: 'assistant', content: answer }
    ]);

    res.json({ answer });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Nastala chyba, skús to prosím znova.' });
  }
});

module.exports = router;
