-- 0159_lead_inbound_vista (2026-10-15): due correzioni della vista v_lead_inbound (migr 0158) dal gate Fable del 15-10.
-- Modulo lead_*, solo la vista: nessuna tabella, nessun dato, nessun flag.
-- (B5) Prima una conversazione usciva dalla lista appena UN suo messaggio era in lead_touches: un "Collega" fallito a meta'
--      (riga 2 della timeline non scritta) la faceva sparire senza decisione e senza via di ripresa. Ora esce solo quando
--      TUTTI i suoi messaggi in entrata con id Gmail sono in timeline (o quando una persona ha deciso): un collegamento a
--      meta' resta in lista e un secondo click completa cio' che manca (le scritture sono idempotenti).
-- (B6) Il dominio del sito si estraeva solo da un indirizzo che inizia con http(s)://: "www.negozio.it" o "negozio.it/shop"
--      non davano mai il candidato "stesso dominio". Ora la regola e' la stessa di dominioDi nella edge.
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
    nullif(regexp_replace(lower(trim(coalesce(a.website, ''))), '^(https?://)?(www\.)?([^/:?#]+).*$', '\3'), '') as dom
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
  and exists (select 1 from cs_messages m where m.conversation_id = b.id and m.direction = 'in' and m.gmail_message_id is not null
    and not exists (select 1 from lead_touches t where t.gmail_message_id = m.gmail_message_id));

revoke all on v_lead_inbound from anon;
grant select on v_lead_inbound to authenticated;

-- controllo finale: la vista si interroga
do $$
begin
  perform 1 from v_lead_inbound limit 1;
end $$;
