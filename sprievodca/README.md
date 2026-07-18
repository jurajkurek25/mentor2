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

## 3. Lokálne spustenie / test

```bash
cd sprievodca
cp .env.example .env
# vyplň .env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY, VOYAGE_API_KEY, ADMIN_PASSWORD
npm install
npm start
```

Otvor `http://localhost:3000` (chat) a `http://localhost:3000/admin` (nahrávanie kníh).

## 4. Nahranie prvej knihy

1. Choď na `/admin`, zadaj heslo z `ADMIN_PASSWORD`
2. Nahraj knihu (napr. export "(Ne)potrebný muž" ako .docx alebo .pdf)
3. Počkaj, kým sa vytvoria embeddings (pri 800-stranovej knihe to môže trvať niekoľko minút)
4. Over v chate, že Sprievodca vie odpovedať na otázky z knihy

## 5. Deployment na Hetzner (CloudPanel + PM2 + Nginx)

Presne ako tvoje ostatné Node.js appky:

1. V CloudPanel vytvor novú **Node.js site** pre `sprievodca.nepotrebnymuz.sk`
2. Nahraj tento priečinok na server (git clone alebo scp), spusti `npm install --production`
3. Vytvor `.env` na serveri s produkčnými kľúčmi (nikdy needituj cez git)
4. Spusti cez PM2:
   ```bash
   pm2 start server.js --name sprievodca
   pm2 save
   ```
5. Nastav Nginx reverse proxy na `sprievodca.nepotrebnymuz.sk` → `localhost:PORT` (podľa portu v `.env`)
   — CloudPanel to väčšinou spraví za teba pri vytváraní Node.js site
6. Over SSL (Let's Encrypt cez CloudPanel)

## Poznámky k nákladom

- **Voyage embeddings:** platíš len pri nahrávaní kníh (jednorazovo), nie pri každej otázke návštevníka
- **Anthropic API:** platíš za každú otázku návštevníka (podľa `CLAUDE_MODEL` v `.env`) —
  pri väčšej návštevnosti zváž `claude-haiku-4-5-20251001` namiesto Sonnetu pre nižšie náklady
- **Supabase:** free tier stačí na začiatok, pgvector je zahrnutý

## Čo appka NEROBÍ (zámerne, pre jednoduchosť)

- Žiadne streamovanie odpovedí (odpoveď príde naraz, nie postupne písmeno po písmene)
- Žiadny rate-limiting na chat endpoint — ak appka zľudovie, treba pridať (napr. `express-rate-limit`)
- Admin heslo je jedno spoločné heslo, nie viacero účtov
