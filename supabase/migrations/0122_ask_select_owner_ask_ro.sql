-- 0122_ask_select_owner_ask_ro.sql (2026-09-14, audit gate A1): correzione della 0121.
-- SET LOCAL ROLE non e' consentito dentro una funzione SECURITY DEFINER ("cannot set parameter role within
-- security-definer function"): la 0121 aveva creato una ask_select che falliva a ogni chiamata. La via giusta e'
-- far POSSEDERE la funzione da ask_ro: cosi' SECURITY DEFINER la fa girare coi privilegi di ask_ro (niente
-- segreti, niente PII). Per riassegnare la proprieta' ad ask_ro serve CREATE sullo schema public: lo concedo il
-- tempo dell'alter e lo revoco subito (ask_ro non deve poter creare oggetti). La denylist di testo resta per le
-- funzioni volatili che PUBLIC puo' comunque eseguire (net/cron/vault/...). postgres e' membro di ask_ro (0121),
-- quindi puo' ancora fare create or replace di questa funzione in futuro.
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
  if q like '%--%' or q like '%/*%' then raise exception 'commenti non consentiti nella query'; end if;
  if q ~* '\m(insert|update|delete|drop|alter|truncate|grant|revoke|create|comment|copy|vacuum|merge|call|do)\M'
    then raise exception 'query non consentita'; end if;
  if q ~* '\m(net|cron|vault|dblink|lo_import|lo_export|pg_read_file|pg_read_binary_file|pg_ls_dir|pg_sleep|pg_settings|current_setting|set_config|http_get|http_post|pg_stat_file|pg_authid|pg_shadow)\M'
    then raise exception 'riferimento non consentito'; end if;
  perform set_config('statement_timeout', '5000', true);
  execute 'select coalesce(jsonb_agg(t), ''[]''::jsonb) from (select * from (' || q || ') sub limit 200) t' into r;
  return r;
end $function$;

grant create on schema public to ask_ro;
alter function public.ask_select(text) owner to ask_ro;
revoke create on schema public from ask_ro;
