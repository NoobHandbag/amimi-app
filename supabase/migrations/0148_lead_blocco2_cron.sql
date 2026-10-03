-- 0148: Negozi B2B, Blocco 2 (brief 22-09, richiesta owner 03-10): lettura automatica delle risposte e
-- follow-up proposti da soli alla scadenza. Modulo lead_* (Regola Ferrea 19): tocca solo tabelle e viste
-- lead_*, core in sola lettura. Chi scrive: la edge `lead-outreach` v5, azione `cron` (service_role).
-- Gate: `app_flags.lead_enabled` (gia' esistente, default 'false'): a flag spento il giro e' NO-OP.
-- Rollback: lead_enabled = 'false', oppure
--   select cron.alter_job((select jobid from cron.job where jobname = 'lead-outreach-cron'), active := false).
--
-- Idempotenza a DB (Regola Ferrea 20):
--   risposte: `lead_touches.gmail_message_id` e' gia' UNIQUE (0111), la edge fa upsert ignoreDuplicates;
--   follow-up: UNA bozza automatica per (negozio, numero di tocco), in qualunque stato. Se una persona
--   la scarta, il cron non la riscrive.

alter table lead_drafts add column if not exists origine text not null default 'manuale';
alter table lead_drafts drop constraint if exists lead_drafts_origine_check;
alter table lead_drafts add constraint lead_drafts_origine_check check (origine in ('manuale', 'auto'));
create unique index if not exists lead_drafts_auto_uq on lead_drafts (account_id, sequenza_tocco)
  where origine = 'auto' and sequenza_tocco is not null;

-- v_lead_outreach: stessa vista della 0114 con una colonna in piu' IN CODA (create or replace non sposta
-- le esistenti): `bozza_auto_tocco` = numero del follow-up che il cron ha gia' scritto e che aspetta la
-- revisione di una persona. Vale solo finche' il negozio e' "contattato" e quel tocco non e' partito.
create or replace view v_lead_outreach with (security_invoker = on) as
select a.id, a.nome, a.tipo, a.citta, a.provincia, a.paese, a.website, a.ig_handle, a.email_generica, a.telefono,
  a.lead_stage, a.verdetto, a.verdetto_motivo, a.tier, a.gancio, a.prossima_azione, a.prossima_azione_at, a.owner_outreach, a.owner_note,
  s.totale, s.tier_proposto,
  t.at as ultimo_tocco_at, t.canale as ultimo_canale, t.direzione as ultima_direzione, t.esito as ultimo_esito, t.chi as ultimo_chi,
  (select count(*) from lead_touches x where x.account_id = a.id) as n_tocchi,
  (select count(*) from lead_touches x where x.account_id = a.id and x.direzione = 'out' and x.canale = 'email') as n_email_out,
  case when t.at is null then null else extract(day from now() - t.at)::int end as giorni_da_ultimo,
  (a.prossima_azione_at is not null and a.prossima_azione_at < current_date) as scaduta,
  (t.direzione = 'in' and a.lead_stage = 'risposto') as da_gestire,
  (select payload->'post'->0->>'asset_path' from lead_evidence e where e.account_id = a.id and e.tipo = 'ig_posts' and payload->'post'->0->>'asset_path' is not null order by captured_at desc limit 1) as thumb,
  (select payload->>'follower' from lead_evidence e where e.account_id = a.id and e.tipo = 'ig_metrics' order by captured_at desc limit 1)::int as follower,
  (select payload->>'telefono' from lead_evidence e where e.account_id = a.id and e.tipo = 'maps' order by captured_at desc limit 1) as telefono_maps,
  (select payload->'emails'->>0 from lead_evidence e where e.account_id = a.id and e.tipo = 'site_meta' order by captured_at desc limit 1) as email_sito,
  (select count(*) from lead_contacts c where c.account_id = a.id and c.opt_out) as n_opt_out,
  (select d.sequenza_tocco from lead_drafts d
    where d.account_id = a.id and d.origine = 'auto' and d.stato = 'proposta' and a.lead_stage = 'contattato'
      and not exists (select 1 from lead_touches x where x.account_id = a.id and x.direzione = 'out' and x.canale = 'email' and x.sequenza_tocco = d.sequenza_tocco)
    order by d.created_at desc limit 1) as bozza_auto_tocco
from lead_accounts a
left join lateral (select * from lead_scores x where x.account_id = a.id order by created_at desc limit 1) s on true
left join lateral (select * from lead_touches y where y.account_id = a.id order by at desc limit 1) t on true
where a.verdetto = 'da_contattare' or a.lead_stage <> 'da_contattare' or a.owner_outreach is not null;
revoke all on v_lead_outreach from anon;
grant select on v_lead_outreach to authenticated;

-- v_lead_followup_due: i negozi a cui il giro automatico puo' proporre il follow-up N+1. Le esclusioni stanno QUI
-- (non solo nella edge) perche' un negozio saltato a ogni giro non deve occupare per sempre i primi posti della
-- lettura: bounce, opt-out, risposta arrivata, bozza gia' scritta (automatica in qualunque stato, o di una persona
-- se ancora viva), ultimo tocco registrato a mano (senza thread le risposte non si leggono). La edge rifa' gli
-- stessi controlli (prossimoFollowUp) come seconda cintura. Solo service_role: nessun grant ai ruoli applicativi.
create or replace view v_lead_followup_due with (security_invoker = on) as
select a.id, a.paese, a.prossima_azione_at, lo.sequenza_tocco as ultimo_tocco, lo.gmail_thread_id
from lead_accounts a
join lateral (
  select t.sequenza_tocco, t.gmail_thread_id, t.at from lead_touches t
  where t.account_id = a.id and t.direzione = 'out' and t.canale = 'email' and t.sequenza_tocco is not null
  order by t.sequenza_tocco desc limit 1) lo on true
where a.lead_stage = 'contattato' and a.verdetto = 'da_contattare' and a.stato_ricerca <> 'rejected'
  and a.prossima_azione_at <= (now() at time zone 'Europe/Rome')::date
  and lo.sequenza_tocco < 4 and lo.gmail_thread_id is not null
  and not exists (select 1 from lead_contacts c where c.account_id = a.id and c.opt_out)
  and not exists (select 1 from lead_touches i where i.account_id = a.id and i.direzione = 'in'
    and i.esito is distinct from 'risposta_automatica'
    and i.at > lo.at - (case when i.esito = 'bounce' then interval '10 minutes' else interval '0' end))
  and not exists (select 1 from lead_drafts d where d.account_id = a.id and d.sequenza_tocco = lo.sequenza_tocco + 1
    and (d.origine = 'auto' or d.stato in ('proposta', 'approvata', 'in_invio', 'inviata')));
revoke all on v_lead_followup_due from anon, authenticated, public;

-- cron del modulo: ogni 30 minuti ai :20 e :50, lontano dai secondi :00-:03 e dagli altri giri
-- (:07 shopify-sync, :10/:25/:40/:55 loyalty-orders, :17 e :27 shopify-stock, :30 ce-guard).
-- Stesso pattern degli altri cron (0138): net.http_post col PIN neutro. Il giro e' NO-OP finche'
-- lead_enabled non e' 'true': la edge legge il flag e risponde senza toccare Gmail ne' il DB.
select cron.schedule('lead-outreach-cron', '20,50 * * * *',
  $$ select net.http_post(
       url := 'https://imszbjeyplaiovylhkgl.supabase.co/functions/v1/lead-outreach',
       headers := '{"Content-Type":"application/json"}'::jsonb,
       body := '{"action":"cron","pin":"x","source":"cron"}'::jsonb
     ) $$);

insert into change_log (tbl, row_id, op, after, chi, source) values
  ('cron.job', 'lead-outreach-cron', 'cron_create',
   '{"schedule":"20,50 * * * *","edge":"lead-outreach","action":"cron","migr":"0148_lead_blocco2_cron","gate":"app_flags.lead_enabled"}'::jsonb,
   'claude-code', 'b2b-blocco2');
