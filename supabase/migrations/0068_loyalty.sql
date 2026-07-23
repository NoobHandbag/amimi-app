-- Loyalty (sottosistema NON-core, additivo, GATED): punti cliente con identita' Shopify via App Proxy.
-- Brief: _CLAUDE_CODE_INBOX/2026-07-22_CLAUDE_CODE_BRIEF_loyalty_app_proxy.md
--
-- Regola Ferrea 13 (spirito): come cs_* e game, la edge `loyalty-proxy` (service_role) e' l'UNICO
--   canale di scrittura controllato. NON passa da write-api perche' NON tocca CE / stock / inventario
--   / Qromo (sottosistema non-core). La edge scrive solo dopo aver verificato la firma HMAC dell'App
--   Proxy Shopify e aver letto `logged_in_customer_id` firmato: e' un canale piu' chiuso, non piu' aperto.
-- RLS: ON su entrambe, NESSUNA policy => ne' anon ne' authenticated leggono/scrivono. Solo il
--   service_role (che bypassa RLS) opera. Test negativo obbligatorio: `set role anon; select/insert` fallisce.

create table if not exists loyalty_points (
  shopify_customer_id text primary key,
  points              int not null default 0,
  updated_at          timestamptz not null default now()
);

-- append-only: audit + base del cap anti-abuso (somma dei delta di oggi, ultimo tocco per il rate-limit).
create table if not exists loyalty_events (
  id                  uuid primary key default gen_random_uuid(),
  shopify_customer_id text not null,
  delta               int not null,
  source              text not null,       -- es. 'game_click'
  meta                jsonb,
  created_at          timestamptz not null default now()
);
create index if not exists loyalty_events_cust_created_idx
  on loyalty_events (shopify_customer_id, created_at desc);

-- RLS ON senza policy => zero accesso diretto dal client (anon E authenticated).
alter table loyalty_points enable row level security;
alter table loyalty_events enable row level security;

-- Cintura e bretelle: azzera i privilegi di tabella per anon/authenticated (un errore di policy futura
-- non potra' mai esporre lettura/scrittura). service_role non e' toccato (bypassa RLS + tiene i grant).
revoke all on loyalty_points, loyalty_events from anon, authenticated;
