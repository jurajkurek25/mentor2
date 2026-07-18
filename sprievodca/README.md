# Sprievodca — AI mentor chat pre nepotrebnymuz.sk

RAG chat aplikácia: ty ako admin nahráš knihy (txt/pdf/docx), systém ich rozseká na úryvky,
uloží ako embeddings do Supabase (pgvector), a pri otázke návštevníka nájde najrelevantnejšie
úryvky naprieč všetkými knihami a pošle ich spolu s otázkou do Claude API.

## 1. Supabase setup

1. V existujúcom (alebo novom) Supabase projekte otvor **SQL Editor**
2. Spusti celý obsah `db/schema.sql`
3. Skopíruj si `SUPABASE_URL` a **service_role** kľúč (Settings → API) — service_role, nie anon key,
   lebo backend potrebuje zapisovať priamo bez RLS obmedzení

## 2. API kľúče

- **Anthropic:** existujúci kľúč, ktorý používaš v ostatných projektoch
- **Voyage AI:** zaregistruj sa na https://www.voyageai.com/ (embeddings, lacné — cca $0.02/milión tokenov),
  vytvor API kľúč
- **Google OAuth (prihlásenie cez Google):** [Google Cloud Console](https://console.cloud.google.com/) →
  APIs & Services → Credentials → **Create OAuth client ID** (typ *Web application*).
  Authorized redirect URI: `https://tvoja-domena.sk/api/auth/google/callback`
  (lokálne: `http://localhost:3000/api/auth/google/callback`). Skopíruj Client ID a Client Secret do `.env`.
- **Stripe (platené predplatné):** pozri sekciu 6 nižšie.

## 3. Lokálne spustenie / test

```bash
cd sprievodca
cp .env.example .env
# vyplň .env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY, VOYAGE_API_KEY, ADMIN_PASSWORD,
# JWT_SECRET, GOOGLE_CLIENT_ID/SECRET, STRIPE_SECRET_KEY, STRIPE_PRICE_ZAKLAD/PREMIUM
npm install
npm start
```

Otvor `http://localhost:3000` (chat) a `http://localhost:3000/admin` (nahrávanie kníh).

## 4. Nahranie prvej knihy

1. Choď na `/admin`, zadaj heslo z `ADMIN_PASSWORD`
2. Nahraj knihu (napr. export "(Ne)potrebný muž" ako .docx alebo .pdf)
3. Počkaj, kým sa vytvoria embeddings (pri 800-stranovej knihe to môže trvať niekoľko minút)
4. Over v chate, že Sprievodca vie odpovedať na otázky z knihy

## 5. Stripe — predplatné za odpovedové tokeny

Návštevník dostane `FREE_MESSAGE_LIMIT` (predvolene 5) bezplatných otázok bez účtu. Potom ho appka
vyzve, aby sa zaregistroval (e-mail+heslo alebo Google) a predplatil si mesačnú kvótu **odpovedových
(output) tokenov** — teda tokenov, ktoré Claude vygeneruje v odpovediach, nie vstupných tokenov
(kontext z kníh sa do kvóty nepočíta).

1. V [Stripe Dashboarde](https://dashboard.stripe.com/) vytvor dva **Products** (Product catalog →
   +Add product), každý s **Recurring** cenou (mesačne):
   - `Sprievodca — Základ` — odporúčaná cena a kvóta nižšie v sekcii "Cenotvorba"
   - `Sprievodca — Premium`
2. Skopíruj **Price ID** oboch (nie Product ID — začína `price_...`) do `.env` ako
   `STRIPE_PRICE_ZAKLAD` a `STRIPE_PRICE_PREMIUM`. Ak zmeníš sumu alebo kvótu, uprav zodpovedajúco
   aj `tokensIncluded`/`priceEurMonthly` v `lib/pricing.js`.
3. Zapni **Customer Portal** (Settings → Billing → Customer portal) a povoľ v ňom prepínanie medzi
   oboma cenami (Subscriptions → "Customers can switch plans") — cez portál si používateľ vie zmeniť
   plán alebo zrušiť predplatné bez zásahu do kódu.
4. Nastav webhook: Developers → Webhooks → **Add endpoint** →
   `https://tvoja-domena.sk/api/billing/webhook`, udalosti: `checkout.session.completed`,
   `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_succeeded`.
   Skopíruj **Signing secret** (`whsec_...`) do `STRIPE_WEBHOOK_SECRET`.
5. Lokálne testovanie webhookov: `stripe listen --forward-to localhost:3000/api/billing/webhook`
   (vypíše dočasný `whsec_...` na použitie v `.env` počas testovania).
6. Začni s **test kľúčmi** (`sk_test_...`), over celý flow (registrácia → predplatné → chat → zrušenie
   cez portál) a až potom prepni na live kľúče.

## 6. Cenotvorba predplatného

Cena je navrhnutá tak, aby pokryla reálne náklady na Claude API s maržou, ktorá zvládne aj
Supabase/Voyage/hosting a prevádzku. Prepočet vychádza z typickej otázky:

| Zložka promptu | ~tokenov |
|---|---|
| Systémový prompt (osobnosť Sprievodcu) | 300 |
| Kontext — 6 úryvkov z kníh (RAG) | 4 000 |
| História rozhovoru (posledných ~20 správ) | 600 |
| Otázka čitateľa | 100 |
| **Vstup spolu** | **~5 000** |
| Odpoveď (output, `max_tokens: 1024`, priemerne kratšia) | ~400 |

Náklad na jednu otázku podľa modelu (Anthropic ceny za 1M tokenov):

| Model | Vstup / Výstup | Náklad na 1 otázku |
|---|---|---|
| **Claude Haiku 4.5** (najlacnejší, odporúčaný default) | $1 / $5 | ~$0.007 |
| Claude Sonnet 5 (kvalitnejšie, drahšie odpovede) | $3 / $15 (zľava $2/$10 do 31.8.2026) | ~$0.014–0.021 |

→ **Nastav `CLAUDE_MODEL=claude-haiku-4-5-20251001`** ako predvolený model pre predplatné — kvalita je
pre mentorský RAG chat (odpovede naviazané na konkrétny kontext z kníh, nie voľná tvorba) dostatočná
a náklady sú ~3× nižšie ako pri Sonnete. Sonnet necháme ako voliteľnú budúcu "Premium" úroveň modelu,
ak by kvalita odpovedí pri Haiku nestačila.

Odporúčané ceny (kvóta = odpovedové tokeny/mesiac, marža ~3× nad COGS pri Haiku):

| Plán | Kvóta | ~počet odpovedí | COGS (Haiku) | Cena/mesiac |
|---|---|---|---|---|
| Základ | 150 000 tokenov | ~300–400 | ~2,60 € | **7,99 €** |
| Premium | 500 000 tokenov | ~1000–1300 | ~8,75 € | **24,99 €** |

Toto sú len odporúčania v `lib/pricing.js` — skutočnú sumu a menu nastavíš priamo v Stripe Products.
Ak neskôr zmeníš model na Sonnet (vyššia kvalita, vyššia cena za token), preváž maržu podľa novej
tabuľky vyššie alebo ceny/kvóty uprav.

## 7. Deployment na Hetzner (CloudPanel + PM2 + Nginx)

Podrobný krok-za-krokom postup (vrátane Supabase/Google/Stripe nastavenia pre produkciu, checklistu
`.env` premenných a otestovania po nasadení) je v samostatnom súbore **[`DEPLOY.md`](./DEPLOY.md)**.

## Poznámky k nákladom

- **Voyage embeddings:** platíš len pri nahrávaní kníh (jednorazovo), nie pri každej otázke návštevníka
- **Anthropic API:** platíš za každú otázku návštevníka (podľa `CLAUDE_MODEL` v `.env`) — pozri sekciu 6
  "Cenotvorba" vyššie pre prepočet nákladov a odporúčané ceny predplatného
- **Stripe:** ~1,5 % + 0,25 € za transakciu (EU karty) — zarátaj do marže, ak chceš presnejší výpočet
- **Supabase:** free tier stačí na začiatok, pgvector je zahrnutý

## Čo appka NEROBÍ (zámerne, pre jednoduchosť)

- Žiadne streamovanie odpovedí (odpoveď príde naraz, nie postupne písmeno po písmene)
- Žiadny samostatný rate-limiting na chat endpoint — namiesto neho platené predplatné kvótou
  odpovedových tokenov a limit bezplatných otázok bez účtu (`FREE_MESSAGE_LIMIT`) prirodzene obmedzujú
  zneužitie; pri veľkej návštevnosti aj tak zváž pridať `express-rate-limit` proti hrubému spamovaniu
- Admin heslo (pre nahrávanie kníh na `/admin`) je jedno spoločné heslo, nie viacero účtov —
  toto je nezávislé od účtov návštevníkov (tie idú cez `/api/auth`)
- Zmena plánu (Základ → Premium) sa rieši cez Stripe Customer Portal ("Spravovať predplatné"),
  nie opätovným kliknutím na "Predplatiť" v appke
