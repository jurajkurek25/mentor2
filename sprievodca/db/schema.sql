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

-- Stripe predplatné — jedno aktívne predplatné na používateľa, kvóta odpovedových (output) tokenov na obdobie
create table if not exists subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade not null unique,
  stripe_customer_id text not null,
  stripe_subscription_id text unique,
  stripe_price_id text,
  plan text,
  status text not null default 'incomplete', -- active | trialing | past_due | canceled | incomplete
  tokens_included int not null default 0,
  tokens_used int not null default 0,
  current_period_start timestamptz,
  current_period_end timestamptz,
  updated_at timestamptz default now()
);

create index if not exists subscriptions_customer_idx on subscriptions(stripe_customer_id);

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
