const express = require('express');
const crypto = require('crypto');

const supabase = require('../lib/supabase');
const { hashPassword, verifyPassword, setAuthCookie, clearAuthCookie } = require('../lib/auth');
const { getAuthUrl, exchangeCodeForProfile } = require('../lib/google');

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function findUserByEmail(email) {
  const { data } = await supabase.from('users').select('*').eq('email', email).maybeSingle();
  return data;
}

// POST /api/auth/register — { email, password }
router.post('/register', async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');

    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Neplatný e-mail.' });
    if (password.length < 8) return res.status(400).json({ error: 'Heslo musí mať aspoň 8 znakov.' });

    const existing = await findUserByEmail(email);
    if (existing) return res.status(409).json({ error: 'Účet s týmto e-mailom už existuje.' });

    const password_hash = await hashPassword(password);
    const { data: user, error } = await supabase
      .from('users')
      .insert({ email, password_hash })
      .select()
      .single();
    if (error) throw error;

    setAuthCookie(res, user);
    res.json({ email: user.email });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Registrácia zlyhala, skús to prosím znova.' });
  }
});

// POST /api/auth/login — { email, password }
router.post('/login', async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');

    const user = await findUserByEmail(email);
    if (!user || !user.password_hash) {
      return res.status(401).json({ error: 'Nesprávny e-mail alebo heslo.' });
    }

    const ok = await verifyPassword(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Nesprávny e-mail alebo heslo.' });

    setAuthCookie(res, user);
    res.json({ email: user.email });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Prihlásenie zlyhalo, skús to prosím znova.' });
  }
});

router.post('/logout', (req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

router.get('/me', (req, res) => {
  res.json({ user: req.user });
});

// GET /api/auth/google — presmerovanie na Google prihlásenie
router.get('/google', (req, res) => {
  const state = crypto.randomBytes(16).toString('hex');
  res.cookie('google_oauth_state', state, { httpOnly: true, maxAge: 10 * 60 * 1000, sameSite: 'lax' });
  res.redirect(getAuthUrl(state));
});

// GET /api/auth/google/callback
router.get('/google/callback', async (req, res) => {
  try {
    const { code, state } = req.query;
    const expectedState = req.cookies?.google_oauth_state;
    res.clearCookie('google_oauth_state');

    if (!code || !state || state !== expectedState) {
      return res.redirect('/login.html?error=google_state');
    }

    const profile = await exchangeCodeForProfile(code);
    if (!profile.email) return res.redirect('/login.html?error=google_no_email');

    const email = profile.email.toLowerCase();
    let user = await findUserByEmail(email);

    if (!user) {
      const { data: created, error } = await supabase
        .from('users')
        .insert({ email, google_id: profile.sub, display_name: profile.name || null })
        .select()
        .single();
      if (error) throw error;
      user = created;
    } else if (!user.google_id) {
      // Účet už existoval (email+heslo) — prepojíme ho s Google, nech sa dá prihlásiť oboma spôsobmi.
      await supabase.from('users').update({ google_id: profile.sub }).eq('id', user.id);
    }

    setAuthCookie(res, user);
    res.redirect('/');
  } catch (err) {
    console.error(err);
    res.redirect('/login.html?error=google_failed');
  }
});

module.exports = router;
