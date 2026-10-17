-- 0163_push.sql (2026-10-17): modulo push_* (Regola Ferrea 19), notifiche native Web Push dell'app al posto di ntfy.
-- Brief: Cowork12/_CLAUDE_CODE_INBOX/2026-10-17_BRIEF_notifiche_native_web_push.md (sez. 4.1). PR A a modulo SPENTO:
-- ntfy resta acceso, ce-guard e sales-guard non si toccano (PR B, brief suo), nessun cron legge queste tabelle.
--
-- Modulo ADDITIVO: prefisso proprio, nessuna colonna sulle tabelle core, del core si legge solo app_flags.
-- Rollback = push_enabled a 'false', senza deploy: push-api risponde enabled:false e la scheda Notifiche sparisce.
--
-- Postura = loyalty_* (migr 0068): RLS accesa, NESSUNA policy, REVOKE a public, anon e authenticated. Nemmeno il team
-- loggato legge queste tabelle: endpoint + p256dh + auth bastano a mandare notifiche a quel telefono, quindi l'unico
-- canale e' la edge push-api col service_role, che non restituisce mai endpoint ne' chiavi.
-- Idempotenza a DB (Regola 20): UNIQUE su endpoint (l'upsert di `iscrivi` lavora su questo vincolo) e su device_id
-- (un telefono = una riga, anche quando su iOS getSubscription() torna null e il browser ne crea una nuova).
-- updated_at senza trigger: nel repo l'unica funzione "touch" e' mat_touch_updated_at (migr 0144), del modulo mat_*;
-- agganciarla qui legherebbe due moduli. updated_at lo scrive push-api quando cambia l'iscrizione.
begin;

-- 1) interruttore: nasce SPENTO. on conflict do nothing: una riaccensione manuale non viene sovrascritta da un re-run.
--    L'esito dell'insert resta nella transazione: il controllo finale pretende 'false' solo se la riga e' nata qui.
do $$ begin
  insert into app_flags (key, value) values ('push_enabled', 'false') on conflict (key) do nothing;
  perform set_config('amimi.push_flag_nato_qui', found::text, true);
end $$;

-- 2) temi: un tema nuovo e' una riga, il frontend li riceve da push-api `config` (solo attivi, per ordine).
--    ordine 10 e 20: un tema nuovo si mette in mezzo senza rinumerare.
create table if not exists push_temi (
  key          text primary key,
  etichetta    text not null,
  descrizione  text,
  ordine       int not null default 0,
  attivo       boolean not null default true,
  constraint push_temi_key_ck check (key ~ '^[a-z_]{2,32}$')
);

insert into push_temi (key, etichetta, descrizione, ordine) values
  ('conti',   'Controlli contabili', 'Quando il controllo dei conti trova un errore nuovo', 10),
  ('vendite', 'Vendite ferme',       'Quando non arrivano ordini da 24 ore',                20)
on conflict (key) do nothing;

-- 3) iscrizioni: una riga per telefono.
create table if not exists push_subscriptions (
  id            uuid primary key default gen_random_uuid(),
  endpoint      text not null,
  p256dh        text not null,
  auth          text not null,
  device_id     uuid not null,                     -- generato dal telefono, in localStorage `amimi_push_device`
  chi           text not null,                     -- chiavi di PEOPLE del web, non i nomi mostrati (Bene = Benny, Ginevra = Ginni)
  temi          text[] not null default '{}',      -- chiavi di push_temi: un array non ha FK, le valida push-api
  etichetta     text,
  user_email    text not null,                     -- solo audit: gli account sono caselle condivise, mai usata per instradare
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  last_seen_at  timestamptz,
  last_ok_at    timestamptz,
  last_test_at  timestamptz,                       -- tetto di una `prova` al minuto
  last_status   int,                               -- ultimo codice HTTP del servizio push
  fail_count    int not null default 0,
  constraint push_subscriptions_endpoint_uk unique (endpoint),
  constraint push_subscriptions_device_uk unique (device_id),
  constraint push_subscriptions_chi_ck check (chi in ('Ale', 'Bene', 'Ginevra'))
);
create index if not exists push_subscriptions_temi_gin on push_subscriptions using gin (temi);

comment on table push_temi is 'Notifiche native: argomenti a cui un telefono si iscrive. Solo service_role (edge push-api).';
comment on table push_subscriptions is 'Notifiche native: un telefono iscritto al Web Push. Solo service_role (edge push-api): endpoint e chiavi non escono mai.';

-- 4) sicurezza. Il grant esplicito al service_role (come 0128) non dipende dai default privileges di chi applica.
alter table push_temi enable row level security;
alter table push_subscriptions enable row level security;
revoke all on push_temi, push_subscriptions from public, anon, authenticated;
grant select, insert, update, delete on push_temi, push_subscriptions to service_role;

-- 5) flag leggibile da tutti i client, SOLO questa chiave (come v_villaggio_settings, migr 0162): Home e scheda Notifiche
--    si nascondono a flag spento. Due differenze volute:
--    - security_barrier: un filtro del client non viene valutato prima del where della vista, quindi non tocca le altre
--      righe di app_flags, che contiene segreti;
--    - revoke anche ad anon e authenticated, non solo a public: la vista e' aggiornabile e scriverebbe in app_flags coi
--      diritti del proprietario, quindi deve restare il SOLO select, qualunque cosa dicano i default privileges.
create or replace view v_push_settings with (security_barrier = true) as
select key, value from app_flags where key in ('push_enabled');

revoke all on v_push_settings from public, anon, authenticated;
grant select on v_push_settings to anon, authenticated;

-- 6) prova dentro la stessa transazione: se qualcosa non torna la migrazione non passa.
--    `create table if not exists` salta in silenzio i vincoli se la tabella esiste gia' (C2 della 0128): qui si contano.
do $$
declare
  t text;
  r name;
  v_vincolo text;
  v_flag text;
  v_nato text := current_setting('amimi.push_flag_nato_qui', true);
  v_grant text;
begin
  foreach t in array array['push_temi', 'push_subscriptions'] loop
    if not (select cl.relrowsecurity from pg_class cl where cl.oid = ('public.' || t)::regclass) then
      raise exception '0163: RLS spenta su %', t;
    end if;
    if exists (select 1 from pg_policy p where p.polrelid = ('public.' || t)::regclass) then
      raise exception '0163: % ha una policy, deve restare senza (solo service_role)', t;
    end if;
    foreach r in array array['anon', 'authenticated'] loop
      if has_table_privilege(r, 'public.' || t, 'select, insert, update, delete, truncate, references, trigger')
         or has_any_column_privilege(r, 'public.' || t, 'select, insert, update, references') then
        raise exception '0163: % ha ancora privilegi su %', r, t;
      end if;
    end loop;
    if not (has_table_privilege('service_role', 'public.' || t, 'select') and has_table_privilege('service_role', 'public.' || t, 'insert')
            and has_table_privilege('service_role', 'public.' || t, 'update') and has_table_privilege('service_role', 'public.' || t, 'delete')) then
      raise exception '0163: service_role non legge e scrive % (push-api non funzionerebbe)', t;
    end if;
  end loop;

  -- vista: anon e authenticated solo SELECT
  foreach r in array array['anon', 'authenticated'] loop
    if not has_table_privilege(r, 'public.v_push_settings', 'select') then
      raise exception '0163: % non legge v_push_settings', r;
    end if;
    if has_table_privilege(r, 'public.v_push_settings', 'insert, update, delete, truncate, references, trigger') then
      raise exception '0163: % puo'' scrivere attraverso v_push_settings', r;
    end if;
  end loop;

  -- grant diretti di qualunque tipo (anche MAINTAIN di PG17, che has_table_privilege su PG15 non conosce) a PUBLIC,
  -- anon e authenticated; sulla vista e' ammesso solo il SELECT ai due ruoli
  select string_agg(format('%s a %s su %s', a.privilege_type, coalesce(g.rolname, 'PUBLIC'), cl.relname), ', ' order by cl.relname)
    into v_grant
    from pg_class cl
    cross join lateral aclexplode(cl.relacl) a
    left join pg_roles g on g.oid = a.grantee
   where cl.oid in ('public.push_temi'::regclass, 'public.push_subscriptions'::regclass, 'public.v_push_settings'::regclass)
     and (a.grantee = 0 or g.rolname in ('anon', 'authenticated'))
     and not (cl.relname = 'v_push_settings' and a.grantee <> 0 and a.privilege_type = 'SELECT');
  if v_grant is not null then raise exception '0163: privilegi di troppo: %', v_grant; end if;

  foreach v_vincolo in array array['push_temi_key_ck', 'push_subscriptions_endpoint_uk', 'push_subscriptions_device_uk', 'push_subscriptions_chi_ck'] loop
    if not exists (select 1 from pg_constraint k where k.conname = v_vincolo and k.connamespace = 'public'::regnamespace) then
      raise exception '0163: vincolo mancante %', v_vincolo;
    end if;
  end loop;
  if to_regclass('public.push_subscriptions_temi_gin') is null then
    raise exception '0163: indice GIN su push_subscriptions.temi mancante';
  end if;
  -- le colonne sono il contratto con push-api: una tabella preesistente diversa non deve passare
  if (select string_agg(a.attname, ',' order by a.attnum) from pg_attribute a
       where a.attrelid = 'public.push_temi'::regclass and a.attnum > 0 and not a.attisdropped)
     is distinct from 'key,etichetta,descrizione,ordine,attivo' then
    raise exception '0163: colonne di push_temi diverse dal contratto';
  end if;
  if (select string_agg(a.attname, ',' order by a.attnum) from pg_attribute a
       where a.attrelid = 'public.push_subscriptions'::regclass and a.attnum > 0 and not a.attisdropped)
     is distinct from 'id,endpoint,p256dh,auth,device_id,chi,temi,etichetta,user_email,created_at,updated_at,last_seen_at,last_ok_at,last_test_at,last_status,fail_count' then
    raise exception '0163: colonne di push_subscriptions diverse dal contratto';
  end if;

  if (select count(*) from push_temi where key in ('conti', 'vendite')) <> 2 then
    raise exception '0163: mancano i temi conti e vendite';
  end if;

  if (select count(*) from v_push_settings) <> 1 or exists (select 1 from v_push_settings where key <> 'push_enabled') then
    raise exception '0163: v_push_settings deve esporre la sola chiave push_enabled';
  end if;

  select value into v_flag from app_flags where key = 'push_enabled';
  if not found then raise exception '0163: manca app_flags.push_enabled'; end if;
  if v_nato is null then raise exception '0163: non so se push_enabled e'' nato in questa migrazione'; end if;
  if v_nato = 'true' and v_flag is distinct from 'false' then
    raise exception '0163: push_enabled nato qui vale % invece di false', v_flag;
  end if;
end $$;

commit;
