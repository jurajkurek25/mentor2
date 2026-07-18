const express = require('express');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');

const supabase = require('../lib/supabase');
const { chunkText } = require('../lib/chunk');
const { embed } = require('../lib/voyage');
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

module.exports = router;
