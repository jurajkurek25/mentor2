const Stripe = require('stripe');

if (!process.env.STRIPE_SECRET_KEY) {
  console.warn('STRIPE_SECRET_KEY nie je nastavený — platby nebudú fungovať.');
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder');

module.exports = stripe;
