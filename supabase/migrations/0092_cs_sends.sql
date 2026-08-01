-- 0092: cs_sends — registro idempotenza dell'INVIO dall'app (Fase 4, edge cs-send).
-- Brief: 2026-07-31_CLAUDE_CODE_BRIEF_cs_fase4_invio_dallapp.md (guardrail anti doppio invio).
--
-- Ogni tentativo di invio porta una send_key (uuid generata dalla UI all'apertura del dialog di
-- conferma). La edge cs-send RIVENDICA la chiave con un INSERT prima di chiamare Gmail: un doppio
-- click o un retry di rete arrivano con la STESSA chiave, trovano la riga (PK) e non producono
-- una seconda email. La riga e' anche l'audit dell'esito (sending|sent|error).
--
-- Sicurezza: stessa postura delle altre cs_* (migr 0053): SELECT solo authenticated, scritture
-- per nessun ruolo applicativo (scrive solo la edge col service_role). Test negativo anon dovuto.

create table if not exists cs_sends (
  send_key         uuid primary key,                                        -- generata dalla UI, una per dialog di conferma
  conversation_id  uuid not null references cs_conversations(id) on delete cascade,
  chi              text,                                                    -- Benedetta|Ginevra|Ale (selettore in-tool, design 3.4)
  to_email         text,
  testo_sha        text,                                                    -- sha256 del testo finale (dedup soft cross-key)
  status           text not null default 'sending',                        -- sending|sent|error
  gmail_message_id text,
  gmail_thread_id  text,
  error            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists cs_sends_conv_idx on cs_sends (conversation_id, created_at desc);

alter table cs_sends enable row level security;
drop policy if exists cs_sends_sel on cs_sends;
create policy cs_sends_sel on cs_sends for select to authenticated using (true);
revoke all on cs_sends from anon, authenticated;
grant select on cs_sends to authenticated;
