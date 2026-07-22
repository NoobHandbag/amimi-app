-- Denylist rumore CS -> app_flags.cs_noise_senders (brief Cowork 22-07, Regola Ferrea 16).
-- Semantica edge cs-sync v2 (verificata su index.ts riga 131): value split /[\n,]+/, trim, match
-- SUBSTRING case-insensitive di ogni voce su From(email) E Subject. Il pattern DMARC "Report Domain"
-- e' anche hardcoded (riga 128): la voce e' ridondante ma innocua.
-- 34 voci: le 36 del deliverable DENYLIST_cs_noise_senders.txt MENO le 2 sensibili
-- (bancodesio.it/studiocssf.it: banca/commercialista, in attesa OK owner esplicito - opzione prevista dal brief).
-- Nessuna voce e' un dominio consumer (cross-check con ALLOWLIST_domini_consumer.md).
-- UPSERT UNION idempotente: se la chiave esiste, fonde le voci distinte (case-insensitive) preservando
-- l'ordine esistente-prima. Al momento la chiave e' ASSENTE (verificato) -> path INSERT.
insert into app_flags(key, value)
values ('cs_noise_senders', array_to_string(array[
  'Report Domain: amimi.it',
  'dmarc.yahoo.com',
  'mimecastreport.com',
  'dmarcreport@microsoft.com',
  'noreply-dmarc-support@google.com',
  'dmarcreport@aruba.it',
  'omegatheme.com',
  'klaviyo.com',
  'supabase.com',
  'email.shopify.com',
  'ads-service.tiktok.com',
  'anthropic.com',
  'claude.com',
  'openai.com',
  'larksuite.com',
  'miro.com',
  'updates.notion.so',
  'github.com',
  'facebookmail.com',
  'business-marketing.facebook.com',
  'developers.facebook.com',
  'paypal.it',
  'paypal.com',
  'klarna.com',
  'twsexpresscourier.it',
  'accounts.google.com',
  'workspace-noreply@google.com',
  'meetings-noreply@google.com',
  'drive-shares-dm-noreply@google.com',
  'zerow.it',
  'marketing.ryanairemail.it',
  'articolipromozionali.eu',
  'message@adobe.com',
  'booking.email.ikea.it'
], E'\n'))
on conflict (key) do update set value = (
  select string_agg(tok, E'\n' order by ord)
  from (
    select distinct on (lower(tok)) tok, ord from (
      select trim(t) tok, ord
        from unnest(regexp_split_to_array(app_flags.value, '[\n,]+')) with ordinality as x(t, ord)
        where trim(t) <> ''
      union all
      select trim(t), 1000 + ord
        from unnest(regexp_split_to_array(excluded.value, '[\n,]+')) with ordinality as y(t, ord)
        where trim(t) <> ''
    ) u order by lower(tok), ord
  ) d
);
