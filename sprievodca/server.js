require('dotenv').config();
const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');

const chatRoutes = require('./routes/chat');
const adminRoutes = require('./routes/admin');
const authRoutes = require('./routes/auth');
const { router: billingRoutes, handleWebhook } = require('./routes/billing');
const { attachUser } = require('./middleware/requireAuth');

const app = express();

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
app.use('/api/chat', chatRoutes);
app.use('/api/admin', adminRoutes);

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Sprievodca beží na porte ${PORT}`));
