-- 0210 - Assistenza: bozze pronte (cs-assist v33, richiesta di Dan del 24-11).
-- La bozza costa ~30 s di Gemini e l'operatrice la aspettava a schermo. Il cron genera la bozza
-- in anticipo (azione `predraft`, una per giro) e la UI la mostra subito: per questo la riga di
-- cs_drafts conserva ora la risposta COMPLETA (tutte le proposte, fonti, schema), non solo il
-- testo della prima.

alter table public.cs_drafts add column if not exists risposta jsonb;
comment on column public.cs_drafts.risposta is 'v33 (24-11): la risposta completa di cs-assist draft (options, schema, fonti, order_admin_url, storia, fallback_singola, troncate). La UI la mostra aprendo il thread senza rigenerare. NULL sulle bozze precedenti.';
comment on column public.cs_drafts.source is 'app = bozza chiesta da operatrice; auto = bozza pronta generata dal cron cs-assist-predraft (v33, 24-11); eval = generata dall''harness di valutazione (scripts/cs-eval.mjs, brief 29-07)';

-- Interruttore, spento: si accende dopo lo smoke del deploy.
insert into public.app_flags (key, value) values ('cs_predraft_attivo', 'false')
on conflict (key) do nothing;

-- Cron ogni 2 minuti. Il comando si copia da cs-assist-summary cambiando solo l'azione: cosi' il
-- PIN non finisce nel repo (amimi-app e' pubblico).
-- Gate 2 (C1): una bozza dura ~30 s, il default di pg_net e' 5 s: timeout a 60 s come le migr
-- 0166/0179/0187, aggiunto dopo `headers := ...,` del comando copiato.
do $$
declare cmd text; nuovo text;
begin
  select command into cmd from cron.job where jobname = 'cs-assist-summary';
  if cmd is null or position('"action":"summary"' in cmd) = 0 then
    raise exception 'cs-assist-summary non trovato o senza "action":"summary": cron predraft non creato';
  end if;
  nuovo := regexp_replace(replace(cmd, '"action":"summary"', '"action":"predraft"'), '(headers\s*:=\s*''[^'']*''::jsonb\s*,)', '\1 timeout_milliseconds := 60000,');
  if position('timeout_milliseconds := 60000' in nuovo) = 0 then
    raise exception 'comando di cs-assist-summary in una forma inattesa: timeout non aggiunto, cron predraft non creato';
  end if;
  if exists (select 1 from cron.job where jobname = 'cs-assist-predraft') then
    perform cron.unschedule('cs-assist-predraft');
  end if;
  perform cron.schedule('cs-assist-predraft', '*/2 * * * *', nuovo);
end $$;
