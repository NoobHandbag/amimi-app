-- 0158_lead_inbound (2026-10-15): blocco C del cruscotto B2B, "ingresso inbound come canale di prima classe".
-- Design confermato da Dan il 15-10 (Cowork12/_CLAUDE_CODE_INBOX/REPORT_b2b_cruscotto_flow_completo_Fase1_2026-10-15.md,
-- sez. 6 C e 8, decisione 6: lista "Messaggi da collegare" nella Coda B2B, cs-* intatte).
-- Modulo lead_* (Regola Ferrea 19): additiva. Una tabella nuova con prefisso proprio e una vista che LEGGE cs_conversations
-- e cs_messages (Assistenza) senza toccarle. Nessun flag nuovo: le azioni stanno dietro lead_outreach_ai_enabled come il
-- resto della scheda; rollback = spegnere quel flag (la vista resta, in sola lettura).

-- 1) Cosa una persona ha deciso di una conversazione di Assistenza che puo' essere un negozio.
--    collegato = messaggi portati su un negozio esistente; creato = negozio nuovo; non_negozio = esce dalla lista.
create table if not exists lead_inbound_esiti (
  cs_conversation_id uuid primary key references cs_conversations(id) on delete cascade,
  esito text not null check (esito in ('collegato', 'creato', 'non_negozio')),
  account_id uuid references lead_accounts(id) on delete set null,
  chi text not null,
  at timestamptz not null default now()
);
alter table lead_inbound_esiti enable row level security;
revoke all on lead_inbound_esiti from anon, authenticated;
grant select on lead_inbound_esiti to authenticated;
drop policy if exists lead_inbound_esiti_sel on lead_inbound_esiti;
create policy lead_inbound_esiti_sel on lead_inbound_esiti for select to authenticated using ((auth.jwt() ->> 'email') ilike '%@amimi.it');
-- scrive solo la edge lead-outreach (service_role): nessuna policy di insert/update/delete per gli utenti

-- 2) Le conversazioni di Assistenza degli ultimi 30 giorni che possono essere un negozio e non sono ancora nel cruscotto.
--    Tre ingressi, misurati il 15-10 (la sola categoria "Collaborazioni e B2B" e' quasi tutta rumore: 103 conversazioni in
--    30 giorni, fra fornitori, fatture, piattaforme e spam): (a) il modulo del sito classificato B2B; (b) le email a
--    wholesale@ (il gruppo: cs-sync le mette nel rumore per gli header di lista, CONOSCENZA 15-10); (c) le email da un
--    indirizzo o da un dominio gia' noti fra i negozi (mai sul solo nome: due "Glitter" diversi esistono).
--    Esce dalla lista una conversazione decisa (lead_inbound_esiti) o con un messaggio gia' in lead_touches.
--    I domini vengono calcolati UNA volta (CTE acc) e confrontati con hash join: la forma correlata impiegava 26 secondi.
create or replace view v_lead_inbound with (security_invoker = on) as
with base as (
  select c.id, c.customer_email, c.customer_name, c.subject, c.snippet, c.last_msg_at, c.categoria, c.gmail_thread_id,
    lower(nullif(trim(c.customer_email), '')) as email,
    regexp_replace(split_part(lower(nullif(trim(c.customer_email), '')), '@', 2), '^www\.', '') as dominio
  from cs_conversations c
  where c.last_msg_at > now() - interval '30 days'
),
msg as (
  select m.conversation_id, bool_or(m.form_fields is not null) as da_modulo,
    bool_or(lower(coalesce(m.to_email, '')) = 'wholesale@amimi.it') as a_wholesale, count(*) as n_in
  from cs_messages m join base b on b.id = m.conversation_id
  where m.direction = 'in'
  group by m.conversation_id
),
acc as (
  select a.id, a.nome, a.citta, a.lead_stage, lower(nullif(trim(a.email_generica), '')) as eg,
    nullif(regexp_replace(lower(coalesce(a.website, '')), '^https?://(www\.)?([^/:?#]+).*$', '\2'), '') as dom
  from lead_accounts a
),
corrisp as (
  select b.id as conv_id, a.id, a.nome, a.citta, a.lead_stage, 'email' as via from base b join acc a on a.eg = b.email
  union
  select b.id, a.id, a.nome, a.citta, a.lead_stage, 'contatto' from base b join lead_contacts lc on lower(lc.email) = b.email join acc a on a.id = lc.account_id
  union
  select b.id, a.id, a.nome, a.citta, a.lead_stage, 'dominio' from base b join acc a on a.dom = b.dominio
  where b.dominio not in ('', 'gmail.com', 'googlemail.com', 'hotmail.com', 'hotmail.it', 'outlook.com', 'outlook.it', 'live.com', 'live.it',
    'yahoo.com', 'yahoo.it', 'icloud.com', 'me.com', 'libero.it', 'virgilio.it', 'alice.it', 'tiscali.it', 'tin.it', 'fastwebnet.it',
    'email.it', 'msn.com', 'aol.com', 'pec.it', 'legalmail.it')
),
cand as (
  select conv_id, jsonb_agg(jsonb_build_object('id', id, 'nome', nome, 'citta', citta, 'lead_stage', lead_stage, 'via', via) order by nome) as candidati
  from corrisp group by conv_id
)
select b.id as conv_id, b.customer_email, b.customer_name, b.subject, b.snippet, b.last_msg_at, b.gmail_thread_id,
  coalesce(msg.da_modulo, false) as da_modulo, coalesce(msg.a_wholesale, false) as a_wholesale, coalesce(msg.n_in, 0) as n_in,
  coalesce(cand.candidati, '[]'::jsonb) as candidati
from base b
left join msg on msg.conversation_id = b.id
left join cand on cand.conv_id = b.id
where ((b.categoria = 'Collaborazioni e B2B' and coalesce(msg.da_modulo, false)) or coalesce(msg.a_wholesale, false) or cand.candidati is not null)
  and not exists (select 1 from lead_inbound_esiti e where e.cs_conversation_id = b.id)
  and not exists (select 1 from cs_messages m join lead_touches t on t.gmail_message_id = m.gmail_message_id where m.conversation_id = b.id);

revoke all on v_lead_inbound from anon;
grant select on v_lead_inbound to authenticated;

-- controllo finale: la vista si interroga e la tabella nasce vuota
do $$
declare n int;
begin
  select count(*) into n from lead_inbound_esiti;
  if n <> 0 then raise exception 'lead_inbound_esiti non vuota: %', n; end if;
  perform 1 from v_lead_inbound limit 1;
end $$;
