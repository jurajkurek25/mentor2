# Nasadenie na server (Hetzner + CloudPanel + PM2 + Nginx)

Konkrétny postup krok za krokom — od prázdneho servera po fungujúce platené predplatné na
`sprievodca.nepotrebnymuz.sk`. Predpokladá, že už máš Hetzner server s nainštalovaným CloudPanel
(rovnaký setup ako tvoje ostatné Node.js appky).

Rob kroky v tomto poradí — každý ďalší potrebuje výstup z predchádzajúceho.

---

## 0. Checklist účtov, ktoré budeš potrebovať

- [ ] Supabase projekt (existujúci alebo nový)
- [ ] Anthropic API kľúč
- [ ] Voyage AI API kľúč
- [ ] Google Cloud Console projekt (na Google login)
- [ ] Stripe účet (aktivovaný na prijímanie platieb, nie len test mode)
- [ ] DNS: `sprievodca.nepotrebnymuz.sk` (alebo tvoja doména) smeruje na IP tvojho Hetzner servera

---

## 1. Supabase — databáza

1. V Supabase projekte otvor **SQL Editor** → **New query**
2. Vlož celý obsah `db/schema.sql` (obsahuje aj nové tabuľky `users`, `subscriptions` — ak si
   appku predtým už nasadzoval bez nich, spustenie je bezpečné, `create table if not exists`
   existujúce tabuľky nezmaže)
3. Spusti (Run)
4. Settings → API → skopíruj `Project URL` a **`service_role`** kľúč (nie `anon` kľúč!)

---

## 2. Google OAuth — prihlásenie cez Google

1. [console.cloud.google.com](https://console.cloud.google.com/) → vytvor projekt (alebo použi
   existujúci)
2. **APIs & Services → OAuth consent screen** — vyplň názov appky ("Sprievodca"), kontaktný e-mail;
   ak appka nie je verejne overená Googlom, pridaj svoj e-mail do **Test users**, kým nepožiadaš
   o verifikáciu (funguje to aj bez verifikácie, len Google ukáže varovanie "unverified app")
3. **APIs & Services → Credentials → Create Credentials → OAuth client ID**
   - Application type: **Web application**
   - Authorized redirect URIs: `https://sprievodca.nepotrebnymuz.sk/api/auth/google/callback`
     (presne táto doména, s `https://`, bez lomítka na konci)
4. Skopíruj **Client ID** a **Client Secret**

---

## 3. Stripe — produkty, ceny, webhook

Rob toto v **Live mode** (prepínač vpravo hore v Stripe Dashboarde) — test mode má úplne
samostatné produkty/kľúče/webhooky, takže si over najprv v test mode (bod 3b nižšie) a až potom
zopakuj v live mode.

1. **Product catalog → + Add product**
   - Názov: `Sprievodca — Základ`
   - Pricing: **Recurring**, mesačne, **7,99 €** (alebo tvoja suma)
   - Ulož, skopíruj **Price ID** (začína `price_...`, nie Product ID `prod_...`)
2. Zopakuj pre `Sprievodca — Premium`, **24,99 €**
3. **Settings → Billing → Customer portal** → zapni, a v sekcii **Products** povoľ oba plány +
   zaškrtni, že zákazník môže meniť plán ("Customers can switch plans")
4. **Developers → Webhooks → Add endpoint**
   - Endpoint URL: `https://sprievodca.nepotrebnymuz.sk/api/billing/webhook`
   - Events to send: `checkout.session.completed`, `customer.subscription.updated`,
     `customer.subscription.deleted`, `invoice.payment_succeeded`
   - Ulož, klikni na endpoint → **Signing secret** → skopíruj (`whsec_...`)
5. **Developers → API keys** → skopíruj **Secret key** (`sk_live_...`)

### 3b. Over si to najprv v Stripe test mode

Prepni Stripe Dashboard do **Test mode**, zopakuj kroky 1–5 vyššie (test produkty/webhook/kľúče sú
oddelené od live), nasaď appku s test kľúčmi (`sk_test_...`), over celý flow testovacou kartou
`4242 4242 4242 4242` (ľubovoľný budúci dátum, ľubovoľné CVC). Až keď funguje, prepni na live kľúče
podľa bodu 4 nižšie.

---

## 4. Príprav `.env` pre produkciu

Na svojom počítači (nie priamo na serveri cez git) si priprav produkčný `.env` podľa
`.env.example`, s týmito hodnotami:

```bash
SUPABASE_URL=...                          # z kroku 1
SUPABASE_SERVICE_ROLE_KEY=...              # z kroku 1

ANTHROPIC_API_KEY=...
CLAUDE_MODEL=claude-haiku-4-5-20251001

VOYAGE_API_KEY=...
VOYAGE_MODEL=voyage-3

ADMIN_PASSWORD=...                         # dlhé, unikátne heslo — nie to isté, čo používaš inde

PORT=3000                                  # alebo iný port, podľa toho, čo nastavíš v CloudPanel
APP_BASE_URL=https://sprievodca.nepotrebnymuz.sk   # BEZ lomítka na konci, s https
NODE_ENV=production                        # dôležité — bez toho nebudú cookies označené ako "secure"

JWT_SECRET=...                             # vygeneruj: openssl rand -hex 32
GOOGLE_CLIENT_ID=...                       # z kroku 2
GOOGLE_CLIENT_SECRET=...                   # z kroku 2
GOOGLE_REDIRECT_URI=https://sprievodca.nepotrebnymuz.sk/api/auth/google/callback

FREE_MESSAGE_LIMIT=5

STRIPE_SECRET_KEY=sk_live_...              # z kroku 3, krok 5 (live, po overení v test mode)
STRIPE_WEBHOOK_SECRET=whsec_...            # z kroku 3, krok 4
STRIPE_PRICE_ZAKLAD=price_...              # z kroku 3, krok 1
STRIPE_PRICE_PREMIUM=price_...             # z kroku 3, krok 2
```

Vygenerovanie `JWT_SECRET` lokálne:

```bash
openssl rand -hex 32
```

---

## 5. Nahratie kódu na server

### Cez CloudPanel — vytvorenie Node.js site

1. CloudPanel → **Add Site → Node.js**
2. Doména: `sprievodca.nepotrebnymuz.sk`
3. Node.js verzia: **18 alebo novšia**
4. App port: rovnaké číslo ako `PORT` v `.env` (napr. `3000`) — CloudPanel ho použije na Nginx
   reverse proxy
5. Po vytvorení site zisti cestu k priečinku appky (zvyčajne
   `/home/<site-user>/htdocs/sprievodca.nepotrebnymuz.sk`)

### Nahratie súborov

Cez SSH (alebo File Manager v CloudPanel):

```bash
# na serveri, v priečinku site
git clone <url-tvojho-repo> .
# alebo ak repo už existuje a len aktualizuješ:
git pull origin main

cd sprievodca   # ak repo obsahuje priečinok sprievodca/ ako v tomto projekte
```

Nahraj pripravený `.env` (z kroku 4) do priečinka `sprievodca/` na serveri — **cez SCP/SFTP alebo
File Manager, nikdy cez git** (README to zámerne zdôrazňuje — `.env` je v `.gitignore`, takže by
sa ani necommitol, ale pre istotu ho nikdy neuklad do repozitára).

```bash
npm install --production
```

---

## 6. Spustenie cez PM2

```bash
cd /cesta/k/sprievodca
pm2 start server.js --name sprievodca
pm2 save
```

Aby appka naštartovala automaticky aj po reštarte servera (ak si to ešte nenastavil):

```bash
pm2 startup
# príkaz, ktorý pm2 vypíše, skopíruj a spusti (raz, ako root)
pm2 save
```

---

## 7. Nginx + SSL

CloudPanel toto väčšinou nastaví automaticky pri vytváraní Node.js site (reverse proxy na
`localhost:PORT`). Over:

1. **SSL/TLS** v CloudPanel pre danú doménu → **Let's Encrypt** → vydaj certifikát
2. Skús otvoriť `https://sprievodca.nepotrebnymuz.sk` v prehliadači — malo by ísť bez upozornenia
   na certifikát

---

## 8. Otestovanie po nasadení (celý flow)

Prejdi si toto v poradí priamo na produkčnej doméne:

1. `https://sprievodca.nepotrebnymuz.sk` sa načíta, chat funguje na anonymné otázky
2. Po `FREE_MESSAGE_LIMIT` otázkach sa zobrazí paywall s dvoma plánmi
3. Registrácia e-mailom + heslom funguje (`/login.html`)
4. Prihlásenie cez Google funguje (over, že po kliknutí "Pokračovať cez Google" ťa appka vráti
   naspäť prihláseného)
5. Klikni "Predplatiť" na plán → prejdeš na Stripe Checkout → **v teste použi kartu
   `4242 4242 4242 4242`**, v live móde skutočnú kartu
6. Po zaplatení sa vrátiš do appky a `accountBar` hore ukazuje zostatok tokenov
7. V Stripe Dashboarde → Developers → Webhooks → tvoj endpoint — over, že posledné eventy majú
   stav **Succeeded** (nie failed/pending — ak failed, over `STRIPE_WEBHOOK_SECRET` a že
   `/api/billing/webhook` je verejne dostupný cez HTTPS)
8. Pošli pár otázok, over, že sa zostatok tokenov znižuje
9. Klikni "Spravovať predplatné" → over, že sa otvorí Stripe Customer Portal a dá sa v ňom zrušiť
   / zmeniť plán
10. `/admin` s `ADMIN_PASSWORD` stále funguje na nahrávanie kníh (nezávislé od účtov návštevníkov)

---

## 9. Aktualizácia appky neskôr

```bash
cd /cesta/k/sprievodca
git pull origin main
npm install --production   # len ak sa zmenil package.json
pm2 restart sprievodca
```

`.env` sa pri `git pull` nedotkne (nie je v repozitári) — meň ho priamo na serveri, ak treba pridať
nový kľúč.

---

## Bezpečnostné pripomienky

- `JWT_SECRET`, `ADMIN_PASSWORD`, `STRIPE_SECRET_KEY`, `SUPABASE_SERVICE_ROLE_KEY` — nikdy nikam
  necommituj, nezdieľaj, a ak niektorý unikne (napr. omylom v logu alebo screenshote), okamžite ho
  v príslušnom dashboarde zruš a vygeneruj nový
- Po zmene `JWT_SECRET` sa všetci prihlásení používatelia automaticky odhlásia (ich staré cookie
  prestane byť platné) — to je v poriadku, len o tom vedz, ak to niekedy budeš meniť
- Stripe webhook endpoint (`/api/billing/webhook`) musí byť verejne dostupný cez HTTPS bez
  autentifikácie — to je normálne, podpis requestu overuje `STRIPE_WEBHOOK_SECRET`, nie heslo
