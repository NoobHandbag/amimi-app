-- 0121_ask_select_hardening.sql (2026-09-14, audit gate A1; OK owner: solo hardening, rotazione segreti dopo)
--
-- ask_select(q) e' la funzione dietro "Chiedi ad Amimi" (ask-data, assistant, tool MCP ask_data): prende una frase
-- in italiano, Gemini la trasforma in una SELECT e ask_select la esegue. Girava SECURITY DEFINER come `postgres`,
-- con l'unica guardia una regex sul testo. Difetti (audit gate 14-09, A1 = A1 del 06-07 ancora aperta):
--   - `select shopify_token from app_config` / `select value from app_flags` leggeva OGNI segreto;
--   - una SELECT puo' chiamare funzioni volatili eseguibili da PUBLIC: `net.http_post(...)` (esfiltrazione) e
--     `cron.schedule(...)` (scrittura differita), che la denylist di parole-chiave non copriva;
--   - il cap di 200 righe e il timeout si aggiravano con un commento `--`.
--
-- Difesa in profondita' (nessun cambio per le domande legittime dell'assistente sui dati business):
--   1) ruolo NOLOGIN `ask_ro` che puo' leggere SOLO le viste/tabelle business: revocate le 22 sensibili (segreti
--      app_config/app_flags, backup _bak_*, change_log con PII/segreti nel campo after, cs_* e lead_* = PII di terzi)
--      e ogni VISTA che ne legge una di rimbalzo;
--   2) la query gira con `set local role ask_ro`: anche se la regex viene aggirata, non puo' leggere un segreto;
--   3) denylist di testo estesa a net/cron/vault/dblink/pg_read_file/... (le funzioni volatili che PUBLIC puo'
--      comunque eseguire) e commenti (`--`, `/*`) vietati.
-- La ROTAZIONE dei segreti (erano leggibili in passato) resta da fare a parte (caso aperto n.5).

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'ask_ro') then create role ask_ro nologin; end if;
end $$;
-- postgres (owner della funzione) deve poter fare SET ROLE ask_ro
grant ask_ro to postgres;
alter role ask_ro set statement_timeout = '5000';

revoke all on schema public from ask_ro;
grant usage on schema public to ask_ro;
grant select on all tables in schema public to ask_ro;   -- include le viste

do $$
declare t text;
begin
  -- tabelle sensibili: segreti, backup, change_log (PII/segreti nel campo after), cs_* e lead_* (PII di terzi)
  for t in
    select tablename from pg_tables
    where schemaname = 'public'
      and (tablename in ('app_config', 'app_flags', 'change_log')
           or tablename like '\_bak\_%' or tablename like 'cs\_%' or tablename like 'lead\_%')
  loop execute format('revoke select on public.%I from ask_ro', t); end loop;
  -- viste che leggono una tabella sensibile: si leggerebbe il dato di rimbalzo (la vista gira come il suo owner)
  for t in
    select viewname from pg_views
    where schemaname = 'public' and definition ~* '\m(cs_|lead_|app_config|app_flags|_bak_)\w*'
  loop execute format('revoke select on public.%I from ask_ro', t); end loop;
end $$;

create or replace function public.ask_select(q text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare r jsonb;
begin
  if q !~* '^\s*select' then raise exception 'solo query SELECT sono consentite'; end if;
  if q ~* ';\s*\S' then raise exception 'una sola query alla volta'; end if;
  -- niente commenti: nascondevano il cap di 200 righe e sono superficie di iniezione
  if q like '%--%' or q like '%/*%' then raise exception 'commenti non consentiti nella query'; end if;
  if q ~* '\m(insert|update|delete|drop|alter|truncate|grant|revoke|create|comment|copy|vacuum|merge|call|do)\M'
    then raise exception 'query non consentita'; end if;
  -- schemi/funzioni con effetti collaterali o accesso a segreti/filesystem, eseguibili anche da PUBLIC
  if q ~* '\m(net|cron|vault|dblink|lo_import|lo_export|pg_read_file|pg_read_binary_file|pg_ls_dir|pg_sleep|pg_settings|current_setting|set_config|http_get|http_post|pg_stat_file|pg_authid|pg_shadow)\M'
    then raise exception 'riferimento non consentito'; end if;
  perform set_config('statement_timeout', '5000', true);
  -- da qui la query gira con i soli privilegi di ask_ro: niente segreti, niente PII, nessuna funzione volatile
  set local role ask_ro;
  execute 'select coalesce(jsonb_agg(t), ''[]''::jsonb) from (select * from (' || q || ') sub limit 200) t' into r;
  return r;
end $function$;
