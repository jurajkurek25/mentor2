const crypto = require('crypto');

// Jednoduchá ochrana admin routes cez heslo v hlavičke X-Admin-Password.
// Frontend (admin.html) si heslo pýta pri načítaní a posiela ho pri každom requeste.
function adminAuth(req, res, next) {
  const password = req.header('X-Admin-Password');
  const expected = process.env.ADMIN_PASSWORD || '';

  // timingSafeEqual vyžaduje rovnakú dĺžku bufferov — preto najprv porovnáme dĺžku cez hash,
  // aby sme nepustili do porovnania rôzne dlhé reťazce (a nezradili dĺžku hesla časovaním).
  const passwordBuf = crypto.createHash('sha256').update(password || '').digest();
  const expectedBuf = crypto.createHash('sha256').update(expected).digest();
  const matches = password && crypto.timingSafeEqual(passwordBuf, expectedBuf);

  if (!matches) return res.status(401).json({ error: 'Nesprávne heslo.' });
  next();
}

module.exports = adminAuth;
