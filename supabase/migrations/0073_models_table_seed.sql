-- 0073: tabella models (brief campi_necessari_prodotto C.1). Un modello -> categoria,
-- product_type, template tema, collezioni standard Shopify. La categoria SPARISCE come input
-- manuale (lo stub di order_multi non scrive piu' 'BAG' fisso, sbagliato per gli accessori);
-- l'upload la legge da qui e DEVE FALLIRE se il modello non ha riga (mai default BAG).
-- Seed VERIFICATO da Nuovo_Prodotto_su_Shopify.md sez. 4.1 (product_type), 4.3 (collezioni,
-- verificate live 2026-06-16), 4.7 (templateSuffix, verificati live 2026-06-16) +
-- LEA BAG X RITA dalle bozze live create il 23-07 (template alternative, collezioni pelle).
-- Mancano BY DESIGN (nessuna fonte verificata, Regola 1: niente invenzioni, decisione owner):
-- ISABELLA, LOLA, ROSE/AGATA ROSE, PORTA_CARTE, SVEVA. Tiger Charm Chain e Gift Card esclusi
-- (Gift Card e' in non_product_codici; il charm si valuta caso per caso).

create table public.models (
  model            text primary key,   -- nome canonico MAIUSCOLO, es. 'LEA BAG'
  model_norm       text generated always as (upper(regexp_replace(model, '\s+', '_', 'g'))) stored,
  categoria        text not null check (categoria in ('PELLE','TESSUTO','ACCESSORI')),
  product_type     text,               -- NULL = non verificato nel manuale: l'upload chiede, non inventa
  template_suffix  text,
  collections      text[] not null default '{}',
  note             text,
  created_at       timestamptz not null default now()
);
create unique index models_model_norm_uq on public.models (model_norm);

alter table public.models enable row level security;
create policy models_read_all on public.models for select using (true);
revoke all on public.models from anon, authenticated;
grant select on public.models to anon, authenticated;

insert into public.models (model, categoria, product_type, template_suffix, collections, note) values
('LEA BAG',        'PELLE',    'Borsa a tracolla',      'alternative',     array['ALL THE BAGS','SHOULDER BAGS','LEATHER BAG','LEA BAG'], null),
('LEA BAG MAXI',   'PELLE',    'Borsa a tracolla maxi', 'leabagmaxi-2',    array['ALL THE BAGS','SHOULDER BAGS','LEATHER BAG','LEA BAG MAXI'], null),
('VALENTINA BAG',  'PELLE',    'Borsa baguette',        'valentinabag',    array['ALL THE BAGS','SHOULDER BAGS','LEATHER BAG','VALENTINA BAG'], null),
('MARIA BAG',      'PELLE',    'Borsa a tracolla',      'mariabag',        array['ALL THE BAGS','SHOULDER BAGS','LEATHER BAG','MARIA BAG'], null),
('AGATA BAG',      'TESSUTO',  'Borsa da sera',         'story',           array['ALL THE BAGS','HANDBAGS','TEXTILE BAG','AGATA BAG'], null),
('ANNIE BAG',      'TESSUTO',  'Mini bag',              'story',           array['ALL THE BAGS','HANDBAGS','TEXTILE BAG','ANNIE BAG'], null),
('NINA BAG',       'TESSUTO',  'Borsa shopper',         'ninabagnew',      array['ALL THE BAGS','TEXTILE BAG','NINA BAG'], 'NON in HANDBAGS/SHOULDER/LEATHER (manuale 4.3)'),
('NINA BAG MAXI',  'TESSUTO',  null,                    'ninabagmaxi-3',   array['ALL THE BAGS','TEXTILE BAG','NINA BAG MAXI'], 'product_type non esplicitato nel manuale 4.1: confermare prima dell''upload'),
('SUNGLASS COVER', 'ACCESSORI', null,                   'sunglassescover', array['ALL THE ACCESSORIES','SUNGLASS COVER'], 'NON in ALL THE BAGS (manuale 4.3)'),
('LAPTOP COVER',   'ACCESSORI', null,                   'laptop',          array['ALL THE ACCESSORIES','LAPTOP COVER'], 'NON in ALL THE BAGS (manuale 4.3)'),
('AIRPODS CASE',   'ACCESSORI', null,                   'airpodscase',     array['ALL THE ACCESSORIES','AIRPODS CASE'], 'NON in ALL THE BAGS (manuale 4.3)'),
('MINI CASE',      'ACCESSORI', null,                   'mini-case',       array['ALL THE ACCESSORIES','MINI CASE'], 'NON in ALL THE BAGS (manuale 4.3)'),
('LEA BAG X RITA', 'PELLE',    null,                    'alternative',     array['ALL THE BAGS','SHOULDER BAGS','LEATHER BAG'], 'verificato live 23-07 dalle 2 bozze create da Cowork; product_type e collezione modello da confermare');
