require('dotenv').config();
const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');

const chatRoutes = require('./routes/chat');
const adminRoutes = require('./routes/admin');
const authRoutes = require('./routes/auth');
const redeemRoutes = require('./routes/redeem');
const { router: billingRoutes, handleWebhook } = require('./routes/billing');
const { attachUser } = require('./middleware/requireAuth');

const app = express();

// Za Nginx reverse proxy (CloudPanel) — bez tohto by req.protocol/secure cookies fungovali nesprávne.
app.set('trust proxy', 1);

// Stripe webhook potrebuje presné (nepreparsované) telo requestu na overenie podpisu —
// preto ho registrujeme PRED express.json() a rovno tu s vlastným raw-body handlerom.
app.post('/api/billing/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  req.rawBody = req.body;
  handleWebhook(req, res);
});

app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());
app.use(attachUser);
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/auth', authRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/redeem', redeemRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/admin', adminRoutes);

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Sprievodca beží na porte ${PORT}`));
