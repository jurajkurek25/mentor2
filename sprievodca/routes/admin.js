const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');

const supabase = require('../lib/supabase');
const { chunkText } = require('../lib/chunk');
const { embed } = require('../lib/voyage');
const { tierById } = require('../lib/pricing');
const adminAuth = require('../middleware/adminAuth');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

router.use(adminAuth);

async function extractText(file) {
  const ext = file.originalname.split('.').pop().toLowerCase();

  if (ext === 'txt' || ext === 'md') {
    return file.buffer.toString('utf-8');
  }
  if (ext === 'pdf') {
    const data = await pdfParse(file.buffer);
    return data.text;
  }
  if (ext === 'docx') {
    const result = await mammoth.extractRawText({ buffer: file.buffer });
    return result.value;
  }
  throw new Error(`Nepodporovaný formát súboru: .${ext} (podporované: .txt, .md, .pdf, .docx)`);
}

// POST /api/admin/documents — nahranie novej knihy/dokumentu
router.post('/documents', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Chýba súbor.' });

    const title = req.body.title || req.file.originalname;
    const text = await extractText(req.file);

    if (!text.trim()) {
      return res.status(400).json({ error: 'Zo súboru sa nepodarilo extrahovať text.' });
    }

    const { data: doc, error: docError } = await supabase
      .from('documents')
      .insert({ title, filename: req.file.originalname })
      .select()
      .single();

    if (docError) throw docError;

    const pieces = chunkText(text);
    const vectors = await embed(pieces, 'document');

    const rows = pieces.map((content, i) => ({
      document_id: doc.id,
      content,
      embedding: vectors[i],
      chunk_index: i
    }));

    // Vloženie po dávkach, aby sme neposielali obrovský insert naraz
    const batchSize = 100;
    for (let i = 0; i < rows.length; i += batchSize) {
      const { error: chunkError } = await supabase.from('chunks').insert(rows.slice(i, i + batchSize));
      if (chunkError) throw chunkError;
    }

    res.json({ document: doc, chunks: rows.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/documents — zoznam nahraných dokumentov
router.get('/documents', async (req, res) => {
  const { data, error } = await supabase
    .from('documents')
    .select('id, title, filename, created_at, chunks(count)')
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// DELETE /api/admin/documents/:id — odstránenie dokumentu (aj s jeho chunkami cez cascade)
router.delete('/documents/:id', async (req, res) => {
  const { error } = await supabase.from('documents').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// Vygeneruje čitateľný kód bez zameniteľných znakov (0/O, 1/I), napr. "K7F2-9XQP".
function generateCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const raw = Array.from(crypto.randomBytes(8))
    .map((b) => alphabet[b % alphabet.length])
    .join('');
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}`;
}

// POST /api/admin/codes — vytvorenie zľavového/darčekového kódu
// { code?, plan, durationDays, maxRedemptions?, note?, expiresAt? }
router.post('/codes', async (req, res) => {
  try {
    const { plan, note } = req.body;
    const tier = tierById(plan);
    if (!tier) return res.status(400).json({ error: 'Neznámy plán.' });

    const durationDays = Number(req.body.durationDays);
    if (!Number.isInteger(durationDays) || durationDays <= 0) {
      return res.status(400).json({ error: 'Trvanie musí byť kladné celé číslo dní.' });
    }

    const maxRedemptions = Number(req.body.maxRedemptions);
    let code = String(req.body.code || '').trim().toUpperCase();
    if (!code) code = generateCode();

    const { data, error } = await supabase
      .from('redemption_codes')
      .insert({
        code,
        plan,
        duration_days: durationDays,
        max_redemptions: Number.isInteger(maxRedemptions) && maxRedemptions > 0 ? maxRedemptions : 1,
        note: note || null,
        expires_at: req.body.expiresAt || null
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') return res.status(409).json({ error: 'Tento kód už existuje.' });
      throw error;
    }

    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/codes — zoznam kódov
router.get('/codes', async (req, res) => {
  const { data, error } = await supabase
    .from('redemption_codes')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// DELETE /api/admin/codes/:id — zrušenie kódu (už priradené členstvá zostávajú platné)
router.delete('/codes/:id', async (req, res) => {
  const { error } = await supabase.from('redemption_codes').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

module.exports = router;
