const { COOKIE_NAME, verifyToken } = require('../lib/auth');

// Prečíta JWT cookie, ak existuje a je platný, nastaví req.user = { id, email }.
// Nikdy sama o sebe nič neblokuje — na to slúži requireAuth nižšie.
function attachUser(req, res, next) {
  const token = req.cookies?.[COOKIE_NAME];
  const payload = token ? verifyToken(token) : null;
  req.user = payload ? { id: payload.sub, email: payload.email } : null;
  next();
}

// Použiť len na routes, kde je prihlásenie povinné (napr. /api/billing/*).
function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Musíš byť prihlásený.' });
  next();
}

module.exports = { attachUser, requireAuth };
