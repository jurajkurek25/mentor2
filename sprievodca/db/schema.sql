-- Spusti toto raz v Supabase SQL Editore (Dashboard → SQL Editor → New query)

create extension if not exists vector;

create table if not exists documents (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  filename text,
  created_at timestamptz default now()
);

create table if not exists chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid references documents(id) on delete cascade,
  content text not null,
  embedding vector(1024),
  chunk_index int,
  created_at timestamptz default now()
);

-- Vector similarity index (IVFFlat — dobre pre stredne veľké kolekcie)
create index if not exists chunks_embedding_idx on chunks
  using ivfflat (embedding vector_cosine_ops) with (lists = 100);

-- Funkcia na similarity search, volaná z backendu
create or replace function match_chunks (
  query_embedding vector(1024),
  match_count int default 6
)
returns table (
  id uuid,
  document_id uuid,
  content text,
  similarity float
)
language sql stable
as $$
  select
    chunks.id,
    chunks.document_id,
    chunks.content,
    1 - (chunks.embedding <=> query_embedding) as similarity
  from chunks
  order by chunks.embedding <=> query_embedding
  limit match_count;
$$;

-- Účty (email+heslo alebo Google login)
create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  password_hash text,
  google_id text unique,
  display_name text,
  created_at timestamptz default now()
);

create index if not exists users_google_idx on users(google_id);

create table if not exists conversations (
  id uuid primary key default gen_random_uuid(),
  session_id text not null,
  user_id uuid references users(id) on delete cascade,
  created_at timestamptz default now()
);

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references conversations(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz default now()
);

create index if not exists messages_conversation_idx on messages(conversation_id);
create index if not exists conversations_session_idx on conversations(session_id);
create index if not exists conversations_user_idx on conversations(user_id);

-- Predplatné — jedno aktívne predplatné na používateľa, kvóta odpovedových (output) tokenov na obdobie.
-- source rozlišuje, či ide o Stripe predplatné, alebo o prístup priradený zľavovým/darčekovým kódom
-- (v tom prípade stripe_* stĺpce zostávajú prázdne).
create table if not exists subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade not null unique,
  stripe_customer_id text,
  stripe_subscription_id text unique,
  stripe_price_id text,
  plan text,
  status text not null default 'incomplete', -- active | trialing | past_due | canceled | incomplete
  tokens_included int not null default 0,
  tokens_used int not null default 0,
  current_period_start timestamptz,
  current_period_end timestamptz,
  source text not null default 'stripe', -- 'stripe' | 'code'
  redemption_code_id uuid,
  updated_at timestamptz default now()
);

-- Pre appky nasadené pred touto zmenou: uvoľní NOT NULL a dorobí nové stĺpce (bezpečné spustiť opakovane).
alter table subscriptions alter column stripe_customer_id drop not null;
alter table subscriptions add column if not exists source text not null default 'stripe';
alter table subscriptions add column if not exists redemption_code_id uuid;

create index if not exists subscriptions_customer_idx on subscriptions(stripe_customer_id);

-- Zľavové / darčekové kódy — vytvára a spravuje admin cez /admin, uplatňuje ich prihlásený používateľ.
create table if not exists redemption_codes (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  plan text not null,               -- 'zaklad' | 'premium' — musí zodpovedať tieru v lib/pricing.js
  duration_days int not null,       -- na koľko dní kód priradí členstvo po uplatnení
  max_redemptions int not null default 1,
  redemption_count int not null default 0,
  note text,                        -- interná poznámka pre admina (napr. "YouTube giveaway 10/2026")
  active boolean not null default true,
  expires_at timestamptz,           -- dokedy sa dá kód uplatniť (null = bez expirácie)
  created_at timestamptz default now()
);

-- Audit — kto ktorý kód uplatnil, a zábrana opakovaného uplatnenia toho istého kódu tým istým používateľom.
create table if not exists redemption_code_uses (
  id uuid primary key default gen_random_uuid(),
  code_id uuid references redemption_codes(id) on delete cascade not null,
  user_id uuid references users(id) on delete cascade not null,
  redeemed_at timestamptz default now(),
  unique (code_id, user_id)
);

create index if not exists redemption_code_uses_user_idx on redemption_code_uses(user_id);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'subscriptions_redemption_code_fkey') then
    alter table subscriptions
      add constraint subscriptions_redemption_code_fkey
      foreign key (redemption_code_id) references redemption_codes(id) on delete set null;
  end if;
end $$;

-- Atomické pripočítanie spotrebovaných odpovedových tokenov (bez race condition pri read-modify-write)
create or replace function increment_tokens_used (p_user_id uuid, p_amount int)
returns table (tokens_used int, tokens_included int)
language sql
as $$
  update subscriptions
  set tokens_used = subscriptions.tokens_used + p_amount,
      updated_at = now()
  where subscriptions.user_id = p_user_id
  returning subscriptions.tokens_used, subscriptions.tokens_included;
$$;
