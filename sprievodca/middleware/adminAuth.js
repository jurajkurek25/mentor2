// Jednoduchá ochrana admin routes cez heslo v hlavičke X-Admin-Password.
// Frontend (admin.html) si heslo pýta pri načítaní a posiela ho pri každom requeste.
function adminAuth(req, res, next) {
  const password = req.header('X-Admin-Password');
  if (!password || password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Nesprávne heslo.' });
  }
  next();
}

module.exports = adminAuth;
