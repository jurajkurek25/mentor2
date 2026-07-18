// Cenové úrovne predplatného. Kvóta sa počíta v odpovedových (output) tokenoch, ktoré Claude
// vygeneruje pri odpovedi — nie vo vstupných tokenoch (kontext z kníh, história).
//
// Skutočnú fakturáciu (suma, mena, obdobie) rieši Stripe Product/Price v Stripe Dashboarde —
// toto je len mapovanie "ktorý Stripe Price ID = koľko tokenov mesačne". Ak zmeníš cenu alebo
// kvótu v Stripe, uprav aj tokensIncluded tu (priceEurMonthly slúži len ako popisok vo frontende).
//
// Odporúčaný základ pre výpočet ceny: Claude Haiku 4.5 ($1 / $5 za milión input/output tokenov —
// najlacnejší aktuálny model), s cca 3x maržou na pokrytie Supabase/Voyage/hostingu a prevádzky.
// Pozri README.md sekciu "Cenotvorba" pre detailný prepočet.
const TIERS = [
  {
    id: 'zaklad',
    priceId: process.env.STRIPE_PRICE_ZAKLAD,
    label: 'Základ',
    tokensIncluded: 150000,
    priceEurMonthly: 7.99
  },
  {
    id: 'premium',
    priceId: process.env.STRIPE_PRICE_PREMIUM,
    label: 'Premium',
    tokensIncluded: 500000,
    priceEurMonthly: 24.99
  }
];

function tierByPriceId(priceId) {
  return TIERS.find((t) => t.priceId === priceId);
}

function tierById(id) {
  return TIERS.find((t) => t.id === id);
}

module.exports = { TIERS, tierByPriceId, tierById };
