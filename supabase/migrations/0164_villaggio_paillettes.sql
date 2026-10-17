-- 0164_villaggio_paillettes.sql (2026-10-16, rivista il 17-10): Paillettes, la gamification del Villaggio (fase 2).
-- Gioca solo Ginni (app_flags.villaggio_paillettes_chi). I punti NON si scrivono da nessuna parte: il client li CALCOLA
-- da v_villaggio_eventi, cioe' da eventi che il database registra comunque (change_log di order_multi e arrival_set,
-- counts) piu' tre tabelle nuove col prefisso del modulo (Regola Ferrea 19): vil_presenze (un'apertura al giorno),
-- vil_verifiche (verifica con il fornitore) e vil_conte_complete (una conta completa registrata al mese).
-- Nessun effetto su CE e giacenze: l'unica scrittura operativa nuova e' supplier_orders.data_consegna, dalla verifica,
-- con il suo change_log come ogni scrittura dell'app. Scrive solo la write-api (service role): azioni
-- villaggio_presenza, fornitore_verifica e villaggio_conta_completa, tutte 409 a flag spento.
-- Regola Ferrea 19: villaggio_paillettes_enabled nasce 'false' e la vista eventi a flag spento non restituisce righe.
begin;

-- Presenza idempotente a DB: la PK (chi, giorno) e' la sola guardia, l'insert e' on conflict do nothing.
create table if not exists vil_presenze (
  chi     text not null,
  giorno  date not null,
  ts      timestamptz not null default now(),
  primary key (chi, giorno)
);

-- righe = [{ id, codice, confermata: boolean, data_prima: 'YYYY-MM-DD'|null, data_dopo: 'YYYY-MM-DD'|null }].
-- Il check sull'array tiene in piedi la vista eventi (jsonb_array_elements su un non-array la farebbe fallire tutta).
create table if not exists vil_verifiche (
  id         uuid primary key default gen_random_uuid(),
  ts         timestamptz not null default now(),
  giorno     date not null,
  fornitore  text not null,
  chi        text not null,
  righe      jsonb not null check (jsonb_typeof(righe) = 'array'),
  nota       text
);

-- Conta completa registrata, non calcolata (Dan 17-10): una al mese, la PK (chi, mese) la rende idempotente come la
-- presenza. mese = 'YYYY-MM' di Roma; codici = quanti codici ha contato nel giro.
create table if not exists vil_conte_complete (
  chi     text not null,
  mese    text not null check (mese ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  ts      timestamptz not null default now(),
  codici  int not null check (codici >= 0),
  primary key (chi, mese)
);

-- Scrive e legge solo il service role: RLS accesa senza policy e nessun privilegio ai ruoli applicativi (i default
-- privileges di public darebbero select ad anon e authenticated).
alter table vil_presenze enable row level security;
alter table vil_verifiche enable row level security;
alter table vil_conte_complete enable row level security;
revoke all on vil_presenze, vil_verifiche, vil_conte_complete from public, anon, authenticated;

-- dal = giorno dell'accensione, si parte da zero (Dan 17-10): al go-live si imposta al giorno in cui si accende il
-- flag, senza migrazione. Il valore qui e' solo il segnaposto della nascita.
insert into app_flags (key, value) values
  ('villaggio_paillettes_enabled', 'false'),
  ('villaggio_paillettes_dal', '2026-10-17'),
  ('villaggio_paillettes_chi', 'Ginevra')
on conflict (key) do nothing;

create or replace view v_villaggio_settings as
select key, value from app_flags
where key in ('villaggio_enabled', 'villaggio_paillettes_enabled', 'villaggio_paillettes_dal', 'villaggio_paillettes_chi');

-- Owner postgres e senza security_invoker, come v_villaggio_settings: anon legge gli eventi della giocatrice senza
-- vedere le tabelle vil_ e app_flags. dal si legge SOLO se e' una data ISO valida: un valore storto (o assente) da'
-- dal NULL e quindi nessuna riga, mai un errore che spegne la vista per tutti. dal vale dalla mezzanotte di Roma;
-- il giorno delle righe che non scelgono la propria data e' la data di Roma del ts.
create or replace view v_villaggio_eventi as
with cfg as (
  select
    coalesce(max(value) filter (where key = 'villaggio_paillettes_enabled') = 'true', false) as acceso,
    max(value) filter (where key = 'villaggio_paillettes_chi') as chi,
    max(case when key = 'villaggio_paillettes_dal' and value ~ '^\d{4}-\d{2}-\d{2}$' and pg_input_is_valid(value, 'date')
             then value::date end)::timestamp at time zone 'Europe/Rome' as dal
  from app_flags
  where key in ('villaggio_paillettes_enabled', 'villaggio_paillettes_chi', 'villaggio_paillettes_dal')
),
ev as (
  select 'presenza'::text as tipo, p.giorno, p.ts, p.giorno::text as ref, 1 as n, p.chi
  from vil_presenze p
  union all
  -- n = righe del gruppo che esistono ANCORA: un ordine tutto cancellato vale 0, una riga cancellata non conta piu'
  select 'ordine', (c.ts at time zone 'Europe/Rome')::date, c.ts, c.row_id,
         (select count(*)::int from supplier_orders so where so.gruppo::text = c.row_id), c.chi
  from change_log c
  where c.op = 'order_multi' and c.source = 'write-api'
  union all
  -- solo gli aumenti: una correzione al ribasso non e' un arrivo. Il case tiene il cast fuori dalle righe non numeriche.
  -- Un arrivo annullato non vale: la riga ordine deve esistere ancora e avere qualcosa di arrivato.
  select 'arrivo', (c.ts at time zone 'Europe/Rome')::date, c.ts, c.row_id, (c.after -> 'delta')::numeric::int, c.chi
  from change_log c
  where c.op = 'arrival_set' and c.source = 'write-api'
    and (case when jsonb_typeof(c.after -> 'delta') = 'number' then (c.after -> 'delta')::numeric end) > 0
    and exists (select 1 from supplier_orders so where so.id::text = c.row_id and so.qty_arrived > 0)
  union all
  -- giorno dal ts, non da data_conta: data_conta la sceglie il chiamante e una conta retrodatata non e' di quel giorno
  select 'conta', (k.ts at time zone 'Europe/Rome')::date, k.ts, k.codice, 1, k.chi
  from counts k
  union all
  select 'verifica', s.giorno, s.ts, s.fornitore,
         (select count(*)::int from jsonb_array_elements(s.righe) e where e -> 'confermata' = 'true'::jsonb), s.chi
  from vil_verifiche s
  union all
  select 'data_aggiunta', s.giorno, s.ts, e ->> 'id', 1, s.chi
  from vil_verifiche s
  cross join lateral jsonb_array_elements(s.righe) e
  where e ->> 'data_prima' is null and e ->> 'data_dopo' is not null
  union all
  select 'conta_completa', (x.ts at time zone 'Europe/Rome')::date, x.ts, x.mese, x.codici, x.chi
  from vil_conte_complete x
)
select ev.tipo, ev.giorno, ev.ts, ev.ref, ev.n
from ev
cross join cfg
where cfg.acceso and ev.chi = cfg.chi and ev.ts >= cfg.dal;

alter view v_villaggio_eventi owner to postgres;
revoke all on v_villaggio_settings, v_villaggio_eventi from public, anon, authenticated;
grant select on v_villaggio_settings, v_villaggio_eventi to anon, authenticated;

commit;

-- Rollback: update app_flags set value = 'false' where key = 'villaggio_paillettes_enabled'; (nessun deploy: pillola,
-- missioni e presenze spariscono, le tre azioni write-api rispondono 409, la vista eventi torna vuota).
