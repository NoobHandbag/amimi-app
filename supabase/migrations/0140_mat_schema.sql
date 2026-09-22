-- 0140: modulo mat_* (materie prime: fornitori, catalogo materiali, offerte/listini, acquisti, asset).
-- Brief: Cowork12/_CLAUDE_CODE_INBOX/BRIEF_migrazione_materiali_supabase.md (17-09, modello dati e seed)
--      + Cowork12/docs/Codice_e_Automazione/BRIEF_fornitori_materie_prime_catalogo_2026-09-22.md (catalogo, rettifiche).
-- Numero 0140 e non 0139: la 0139 (lead_outreach_ai) e' stata applicata in produzione il 22-09 da un'altra sessione.
--
-- Modulo ADDITIVO (Regola Ferrea 19): prefisso proprio, core solo in lettura (suppliers via FK opzionale, mai scritto),
-- nessuna colonna aggiunta a tabelle esistenti, nessun innesto in write-api. Flag app_flags.mat_enabled default OFF.
-- Le materie prime NON hanno CODICE_AMIIMI, NON hanno giacenza e NON entrano nel CE: per questo non stanno in
-- supplier_orders/purchases (che alimentano stock e COGS, Regola 17). Registro separato, FK-ready per un futuro aggancio.
--
-- Postura di sicurezza = lead_* (migr 0111): i contatti fornitore includono dati personali di terzi e i listini sono
-- commercialmente sensibili; il client principale della PWA e' anon senza login.
--   - SELECT solo authenticated con email @amimi.it (RLS); anon = niente (REVOKE + nessuna policy).
--   - Scritture (Fase 1): SOLO lo script di seed dichiarato (etl/seed_mat.mjs, service_role) con audit in mat_events.
--     Nessun INSERT/UPDATE/DELETE ai ruoli applicativi: la UI di Fase 1 e' in sola lettura; la Fase 2 porta l'edge mat-api.
--   - Bucket Storage `mat-assets` PRIVATO (foto, schede tecniche, proforma): lettura solo authenticated @amimi.it via URL firmati.
--   - Unica eccezione anon: v_mat_settings (solo la chiave mat_enabled) per nascondere la tile in Home a flag spento.
--
-- Idempotenza a DB (Regola 20): UNIQUE sulle chiavi naturali (fornitore per nome, materiale per fornitore+materiale+colore,
-- offerta per item+data+fonte, ordine per fornitore+numero documento, riga per ordine+item, asset per path).

-- ---------------------------------------------------------------------------
-- Tabelle
-- ---------------------------------------------------------------------------
create table if not exists mat_suppliers (
  id                    uuid primary key default gen_random_uuid(),
  nome                  text not null,                       -- nome corto ("Vicenza Pelli")
  ragione_sociale       text,
  categoria_principale  text,
  email                 text,
  telefono              text,
  referente             text,
  indirizzo             text,
  piva_vat              text,
  deposito_luogo        text,
  condizioni_pagamento  text,
  note                  text,
  attivo                boolean not null default true,
  core_supplier_id      uuid references suppliers(id),       -- solo lettura del core; oggi nessun fornitore fa entrambe le cose
  chi                   text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create unique index if not exists mat_suppliers_nome_uq on mat_suppliers (lower(nome));

create table if not exists mat_items (
  id                  uuid primary key default gen_random_uuid(),
  supplier_id         uuid not null references mat_suppliers(id) on delete restrict,
  categoria           text not null check (categoria in (
                        'Tessuto','Tessuto velluto','Animalier','Cocco','Vitello stampato','Pelle vitello',
                        'Vernice','Crosta/Velour','Nappa','Nastri','Accessori metallici')),
  materiale           text not null,                         -- nome articolo ("Mucca Zigrinata (Horsy 9017 White)")
  articolo_fornitore  text,
  colore              text,
  unita               text check (unita in ('mq','ml','mt','pz')),
  attivo              boolean not null default true,
  note                text,
  chi                 text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create unique index if not exists mat_items_uq on mat_items (supplier_id, lower(materiale), lower(coalesce(colore, '')));
create index if not exists mat_items_cat_idx on mat_items (categoria);

create table if not exists mat_offers (
  id               uuid primary key default gen_random_uuid(),
  item_id          uuid not null references mat_items(id) on delete cascade,
  tipo             text not null default 'offerta' check (tipo in ('offerta','listino')),
  prezzo           numeric(12,4),                            -- SOLO se valore singolo e certo (Regola 1)
  prezzo_text      text,                                     -- testo fedele per range e scaglioni ("40-45/mq")
  valuta           text not null default 'EUR',
  unita            text check (unita in ('mq','ml','mt','pz')),
  disponibilita    text,
  min_ordine       text,
  lead_time        text,
  data             date,
  documento_fonte  text,
  note             text,
  chi              text,
  created_at       timestamptz not null default now()
);
create unique index if not exists mat_offers_uq on mat_offers (item_id, coalesce(data, date '1900-01-01'), lower(coalesce(documento_fonte, '')));

create table if not exists mat_orders (
  id                    uuid primary key default gen_random_uuid(),
  supplier_id           uuid not null references mat_suppliers(id) on delete restrict,
  tipo_documento        text check (tipo_documento in ('fattura','fattura_proforma','altro')),
  numero_documento      text not null,
  data_documento        date,
  valuta                text not null default 'EUR',
  totale_imponibile     numeric(12,2),
  totale_iva            numeric(12,2),
  totale_documento      numeric(12,2),
  condizioni_pagamento  text,
  deposito_luogo        text,
  stato                 text not null default 'ordinato' check (stato in ('ordinato','pagato','ricevuto','annullato')),
  note                  text,
  chi                   text,
  created_at            timestamptz not null default now()
);
create unique index if not exists mat_orders_uq on mat_orders (supplier_id, lower(numero_documento));

create table if not exists mat_order_lines (
  id               uuid primary key default gen_random_uuid(),
  order_id         uuid not null references mat_orders(id) on delete cascade,
  item_id          uuid not null references mat_items(id) on delete restrict,
  quantita         numeric(12,3),
  unita            text check (unita in ('mq','ml','mt','pz')),
  prezzo_unitario  numeric(12,4),
  sconto_text      text,
  importo          numeric(12,2),                            -- imponibile riga
  iva_percent      numeric(5,2),
  note             text,
  created_at       timestamptz not null default now()
);
create unique index if not exists mat_order_lines_uq on mat_order_lines (order_id, item_id);

-- Asset (bucket mat-assets). Livelli di aggancio:
--   item_id          -> foto/scheda di UN colore
--   materiale        -> foto/scheda di un materiale in tutti i colori (chiave: supplier_id + materiale)
--   order_id         -> proforma/fattura di un acquisto
--   solo supplier_id -> documento generale del fornitore (manuale, politica, listino)
create table if not exists mat_assets (
  id           uuid primary key default gen_random_uuid(),
  supplier_id  uuid not null references mat_suppliers(id) on delete cascade,
  item_id      uuid references mat_items(id) on delete cascade,
  materiale    text,
  order_id     uuid references mat_orders(id) on delete cascade,
  path         text not null unique,                        -- path nel bucket mat-assets
  tipo         text not null check (tipo in ('foto','scheda_tecnica','proforma','documento','campione')),
  titolo       text,
  mime         text,
  bytes        integer,
  fonte        text,                                        -- da dove viene (email, data, mittente)
  chi          text,
  created_at   timestamptz not null default now()
);
create index if not exists mat_assets_item_idx on mat_assets (item_id);
create index if not exists mat_assets_mat_idx on mat_assets (supplier_id, lower(coalesce(materiale, '')));

-- Audit del modulo (service_role). Non usa change_log (core).
create table if not exists mat_events (
  id        bigserial primary key,
  at        timestamptz not null default now(),
  chi       text not null,
  azione    text not null,
  tabella   text,
  riga_id   uuid,
  before    jsonb,
  after     jsonb,
  note      text
);

-- ---------------------------------------------------------------------------
-- Viste (security_invoker: la RLS dell'utente vale anche attraverso la vista)
-- ---------------------------------------------------------------------------
create or replace view v_mat_catalogo with (security_invoker = on) as
select
  i.id as item_id, i.supplier_id, s.nome as fornitore, i.categoria, i.materiale, i.articolo_fornitore, i.colore,
  i.unita, i.attivo, i.note,
  o.id as offerta_id, o.tipo as offerta_tipo, o.prezzo as offerta_prezzo, o.prezzo_text as offerta_prezzo_text,
  o.unita as offerta_unita, o.disponibilita, o.min_ordine, o.lead_time, o.data as offerta_data, o.documento_fonte as offerta_fonte,
  a.numero_documento as acquisto_documento, a.data_documento as acquisto_data, a.quantita as acquisto_quantita,
  a.unita as acquisto_unita, a.prezzo_unitario as acquisto_prezzo, a.importo as acquisto_importo,
  (a.line_id is not null) as acquistato,
  coalesce(a.prezzo_unitario, o.prezzo) as prezzo_rif,
  case when a.prezzo_unitario is not null then null else o.prezzo_text end as prezzo_rif_text,
  coalesce(a.unita, o.unita, i.unita) as unita_rif,
  f.foto_path, f.n_foto, f.n_schede,
  s.condizioni_pagamento, s.deposito_luogo, s.email as fornitore_email, s.telefono as fornitore_telefono,
  s.referente as fornitore_referente
from mat_items i
join mat_suppliers s on s.id = i.supplier_id
left join lateral (
  select x.* from mat_offers x where x.item_id = i.id order by x.data desc nulls last, x.created_at desc limit 1
) o on true
left join lateral (
  select l.id as line_id, l.quantita, l.unita, l.prezzo_unitario, l.importo, r.numero_documento, r.data_documento
  from mat_order_lines l join mat_orders r on r.id = l.order_id
  where l.item_id = i.id and r.stato <> 'annullato'
  order by r.data_documento desc nulls last, l.created_at desc limit 1
) a on true
-- asset del materiale in UNA passata: agganciati al colore (item_id) o a tutti i colori (materiale);
-- la foto del colore vince su quella generica (coalesce: item_id NULL non deve finire primo per il DESC)
left join lateral (
  select
    count(*) filter (where x.tipo = 'foto') as n_foto,
    count(*) filter (where x.tipo in ('scheda_tecnica','documento')) as n_schede,
    (array_agg(x.path order by coalesce(x.item_id = i.id, false) desc, x.created_at asc) filter (where x.tipo = 'foto'))[1] as foto_path
  from mat_assets x
  where x.item_id = i.id or (x.item_id is null and x.order_id is null and x.supplier_id = i.supplier_id
        and lower(coalesce(x.materiale, '')) = lower(i.materiale))
) f on true;

create or replace view v_mat_fornitori with (security_invoker = on) as
select s.*,
  (select count(*) from mat_items i where i.supplier_id = s.id and i.attivo) as n_materiali,
  (select string_agg(distinct i.categoria, ', ' order by i.categoria) from mat_items i where i.supplier_id = s.id and i.attivo) as categorie,
  (select count(*) from mat_offers o join mat_items i on i.id = o.item_id where i.supplier_id = s.id) as n_offerte,
  (select count(*) from mat_orders r where r.supplier_id = s.id and r.stato <> 'annullato') as n_ordini,
  (select round(sum(r.totale_imponibile), 2) from mat_orders r where r.supplier_id = s.id and r.stato <> 'annullato') as tot_imponibile,
  (select max(r.data_documento) from mat_orders r where r.supplier_id = s.id and r.stato <> 'annullato') as ultimo_acquisto,
  (select count(*) from mat_assets x where x.supplier_id = s.id) as n_asset
from mat_suppliers s;

create or replace view v_mat_acquisti with (security_invoker = on) as
select l.id as line_id, r.id as order_id, r.supplier_id, s.nome as fornitore, r.tipo_documento, r.numero_documento,
  r.data_documento, r.valuta, r.stato, r.totale_imponibile, r.totale_iva, r.totale_documento, r.condizioni_pagamento,
  i.id as item_id, i.categoria, i.materiale, i.colore,
  l.quantita, l.unita, l.prezzo_unitario, l.sconto_text, l.importo, l.iva_percent, l.note
from mat_order_lines l
join mat_orders r on r.id = l.order_id
join mat_suppliers s on s.id = r.supplier_id
join mat_items i on i.id = l.item_id;

create or replace view v_mat_assets with (security_invoker = on) as
select x.*, s.nome as fornitore, i.materiale as item_materiale, i.colore as item_colore, r.numero_documento as ordine_documento
from mat_assets x
join mat_suppliers s on s.id = x.supplier_id
left join mat_items i on i.id = x.item_id
left join mat_orders r on r.id = x.order_id;

-- Flag del modulo, leggibile da tutti i client (solo questa chiave): la Home nasconde la tile a flag spento.
create or replace view v_mat_settings as
select key, value from app_flags where key in ('mat_enabled');

-- ---------------------------------------------------------------------------
-- Sicurezza: RLS + grant (postura lead_*)
-- ---------------------------------------------------------------------------
do $$ declare t text; begin
  foreach t in array array['mat_suppliers','mat_items','mat_offers','mat_orders','mat_order_lines','mat_assets','mat_events'] loop
    execute format('alter table %I enable row level security', t);
    execute format('revoke all on %I from anon, authenticated', t);
    execute format('grant select on %I to authenticated', t);
    execute format('drop policy if exists %I on %I', t || '_sel', t);
    execute format('create policy %I on %I for select to authenticated using ((auth.jwt() ->> ''email'') ilike ''%%@amimi.it'')', t || '_sel', t);
  end loop;
end $$;
revoke all on mat_events from authenticated;                -- l'audit lo legge solo il service_role
drop policy if exists mat_events_sel on mat_events;
revoke all on v_mat_catalogo, v_mat_fornitori, v_mat_acquisti, v_mat_assets from anon, public;
grant select on v_mat_catalogo, v_mat_fornitori, v_mat_acquisti, v_mat_assets to authenticated;
revoke all on v_mat_settings from public;
grant select on v_mat_settings to anon, authenticated;

-- Storage: bucket privato per foto, schede tecniche e proforma
insert into storage.buckets (id, name, public) values ('mat-assets', 'mat-assets', false) on conflict (id) do nothing;
drop policy if exists mat_assets_sel on storage.objects;
create policy mat_assets_sel on storage.objects for select to authenticated
  using (bucket_id = 'mat-assets' and (auth.jwt() ->> 'email') ilike '%@amimi.it');

-- Flag del modulo (default OFF = rollback dichiarato della Regola 19)
insert into app_flags (key, value) values ('mat_enabled', 'false') on conflict (key) do nothing;
