-- 0194_lead_inbound_senza_chat.sql (2026-11-13): la vista v_lead_inbound (migr 0158, 0159) salta le chat del sito.
-- Punto 23 di docs/PROPOSTA_chat_sito.md 7.6 (chat del sito, Fase 1 pezzo 6). Modulo lead_*, solo la vista: nessuna
-- tabella, nessun dato, nessun flag. Una chat proiettata in Assistenza (migr 0193) ha gmail_thread_id = 'chat:<uuid>',
-- che non e' un thread Gmail: se l'email dichiarata nel widget coincideva con quella di un negozio la vista la proponeva da
-- collegare, e il collegamento copiava 'chat:<uuid>' nei tocchi, poi letto da lead-outreach con threads.get (un 404
-- gestito, ogni altro stato ferma il giro). Le chat restano in Assistenza; il B2B dalla chat si gestisce da li'.
-- Unica differenza dalla 0159: la riga `and c.gmail_thread_id not like 'chat:%'` in `base` (vale anche per una chat
-- spostata nel rumore, che resta 'chat:'). File separato dalla 0193 perche' la vista resta leggibile dal team come prima
-- (security_invoker, grant select ad authenticated), mentre le regole delle migrazioni della chat (tests/chat_guardie.mjs)
-- vietano grant ad authenticated che non siano per colonna sulle tabelle chat_.
begin;

create or replace view v_lead_inbound with (security_invoker = on) as
with base as (
  select c.id, c.customer_email, c.customer_name, c.subject, c.snippet, c.last_msg_at, c.categoria, c.gmail_thread_id,
    lower(nullif(trim(c.customer_email), '')) as email,
    regexp_replace(split_part(lower(nullif(trim(c.customer_email), '')), '@', 2), '^www\.', '') as dominio
  from cs_conversations c
  where c.last_msg_at > now() - interval '30 days'
    and c.gmail_thread_id not like 'chat:%'
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

-- controllo finale: la vista si interroga e non vede le chiavi della chat
do $chk$
begin
  perform 1 from v_lead_inbound limit 1;
  if exists (select 1 from v_lead_inbound where gmail_thread_id like 'chat:%') then
    raise exception '0194: v_lead_inbound vede ancora una chat del sito';
  end if;
  if not exists (select 1 from pg_class where oid = 'public.v_lead_inbound'::regclass and reloptions @> array['security_invoker=on']) then
    raise exception '0194: v_lead_inbound senza security_invoker';
  end if;
end;
$chk$;

commit;
