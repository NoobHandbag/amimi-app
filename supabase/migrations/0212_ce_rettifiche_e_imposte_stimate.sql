-- 0212_ce_rettifiche_e_imposte_stimate.sql (2026-11-25, brief hub `BRIEF_cogs_materiali_e_imposte_2026-11-25.md`, Parti B e C)
--
-- SOLO STRUTTURA: dopo questa migrazione il CE e' identico al centesimo (ce_rettifiche nasce vuota, guardia in fondo).
-- I numeri entrano con la 0213, dopo l'OK di Dan sulla tabella mese per mese (Regola Ferrea 11).
--
-- 1) ce_rettifiche: righe di rettifica del CE per mese, separate dalle vendite. Servono quando un costo di un mese
--    passato va corretto senza riscrivere i cogs_snapshot delle singole vendite (che restano la traccia di cio' che il
--    sistema sapeva il giorno della vendita). Primo uso: il COGS dei materiali comprati da Amimi (pelle, tessuti) che
--    da gennaio 2026 non entrava nel costo delle borse, e i dazi India spostati da logistica a COGS.
--    Visibili nel drill (v_ce_drill_cogs canale 'rettifica'/'rettifica_gift', v_ce_drill_expense categoria 'RETTIFICA').
--    Annullabili: attiva = false (la riga resta, con chi e quando), poi ri-chiusura dei mesi chiusi toccati.
--    Scrittura solo via migrazione, come ce_compensi_soci e ce_totale_manual.
-- 2) v_ce_rettifica_cogs_materiali: il calcolo vivo del delta COGS per mese e canale (regole sez. 2 del brief, approvate
--    da Dan come stima prudente). Le righe di ce_rettifiche si scrivono da qui al momento della 0213 e poi non si muovono
--    piu' da sole; la vista resta per confronto (cio' che direbbe oggi il calcolo).
-- 3) Imposte stimate (Parte C): ce_imposte_aliquote + v_ce_imposte_stimate. IRES 24% sull'utile ante imposte progressivo
--    dell'anno (MC2 del CE Totale), IRAP 3,9% sulla base stimata MC2 + salari. Riga SEPARATA: non entra in mc1, mc2 ne'
--    nella base del compenso soci. Aliquote e base da confermare con Sergio (Studio CSSF).

------------------------------------------------------------------------------------------------ 1) tabella
create table if not exists public.ce_rettifiche (
  id bigserial primary key,
  gruppo text not null,                     -- operazione che le ha scritte, es. 'cogs_materiali_2026-11'
  year int not null,
  month int not null check (month between 1 and 12),
  linea text not null check (linea in ('cogs', 'logistica_var')),
  canale text check (canale in ('online', 'offline', 'b2b', 'gift')),
  in_amimi boolean not null,                -- false = solo CE Totale (gift)
  importo numeric(12, 2) not null,          -- segno del CE: negativo = costo in piu'
  motivo text not null,
  dettaglio jsonb,
  attiva boolean not null default true,
  created_at timestamptz not null default now(),
  created_by text not null,
  annullata_at timestamptz,
  annullata_by text,
  check (canale is null or linea = 'cogs'),
  check (canale is distinct from 'gift' or not in_amimi),
  check (attiva or (annullata_at is not null and annullata_by is not null))
);
create unique index if not exists ce_rettifiche_uq on public.ce_rettifiche (gruppo, year, month, linea, coalesce(canale, ''));
comment on table public.ce_rettifiche is
  'Rettifiche del CE per mese (migr 0212): COGS e logistica variabile. Annullare = attiva false + ri-chiusura. Scrittura solo via migrazione.';
alter table public.ce_rettifiche enable row level security;
drop policy if exists ce_rettifiche_read on public.ce_rettifiche;
create policy ce_rettifiche_read on public.ce_rettifiche for select using (true);
grant select on public.ce_rettifiche to anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'ask_ro') then grant select on public.ce_rettifiche to ask_ro; end if;
end $$;

------------------------------------------------------------------------------------------------ viste CE
-- Sostituzione sulla definizione viva, come la 0173: ogni pezzo deve comparire esattamente una volta.
do $$
declare
  def text;
  r record;
  rt_tot text := $f$rt AS (
                         SELECT ce_rettifiche.year,
                            ce_rettifiche.month,
                            COALESCE(sum(ce_rettifiche.importo) FILTER (WHERE (ce_rettifiche.linea = 'cogs'::text)), (0)::numeric) AS cogs,
                            COALESCE(sum(ce_rettifiche.importo) FILTER (WHERE (ce_rettifiche.linea = 'logistica_var'::text)), (0)::numeric) AS logistica_var
                           FROM ce_rettifiche
                          WHERE ce_rettifiche.attiva
                          GROUP BY ce_rettifiche.year, ce_rettifiche.month
                        ), ex AS ($f$;
  rt_ami text;
begin
  rt_ami := replace(rt_tot, 'WHERE ce_rettifiche.attiva', 'WHERE (ce_rettifiche.attiva AND ce_rettifiche.in_amimi)');

  -- v_ce_totale
  def := pg_get_viewdef('public.v_ce_totale'::regclass);
  for r in select * from (values
      ('ex AS (', rt_tot),
      ('COALESCE(m.cogs, (0)::numeric)) AS cogs', 'COALESCE(m.cogs, (0)::numeric)) + COALESCE(rt.cogs, (0)::numeric) AS cogs'),
      ('COALESCE(m.logistica_var, ex.logistica_var, (0)::numeric) AS logistica_var',
       'COALESCE(m.logistica_var, ex.logistica_var, (0)::numeric) + COALESCE(rt.logistica_var, (0)::numeric) AS logistica_var'),
      ('LEFT JOIN ce_totale_manual m ON', 'LEFT JOIN rt ON ((rt.year = p.year) AND (rt.month = p.month)) LEFT JOIN ce_totale_manual m ON')
    ) v(vecchio, nuovo) loop
    if (length(def) - length(replace(def, r.vecchio, ''))) / length(r.vecchio) <> 1 then
      raise exception '0212: in v_ce_totale "%" non compare esattamente una volta', r.vecchio;
    end if;
    def := replace(def, r.vecchio, r.nuovo);
  end loop;
  execute 'create or replace view public.v_ce_totale as ' || def;

  -- v_ce_amimi (brand): solo le righe in_amimi
  def := pg_get_viewdef('public.v_ce_amimi'::regclass);
  for r in select * from (values
      ('ex AS (', rt_ami),
      ('COALESCE(b2.cogs, (0)::numeric))) AS cogs', 'COALESCE(b2.cogs, (0)::numeric))) + COALESCE(rt.cogs, (0)::numeric) AS cogs'),
      ('COALESCE(ex.logistica_var, (0)::numeric) AS logistica_var',
       'COALESCE(ex.logistica_var, (0)::numeric) + COALESCE(rt.logistica_var, (0)::numeric) AS logistica_var'),
      ('LEFT JOIN qret ON', 'LEFT JOIN rt ON ((rt.year = p.year) AND (rt.month = p.month)) LEFT JOIN qret ON')
    ) v(vecchio, nuovo) loop
    if (length(def) - length(replace(def, r.vecchio, ''))) / length(r.vecchio) <> 1 then
      raise exception '0212: in v_ce_amimi "%" non compare esattamente una volta', r.vecchio;
    end if;
    def := replace(def, r.vecchio, r.nuovo);
  end loop;
  execute 'create or replace view public.v_ce_amimi as ' || def;

  -- v_ce_completezza: una rettifica della logistica non e' una spesa, quindi esce dalle "spese nel CE" (altrimenti
  -- ce_completezza_spese suonerebbe sui mesi dei dazi India).
  def := pg_get_viewdef('public.v_ce_completezza'::regclass);
  for r in select * from (values
      ('COALESCE(v_ce_totale.logistica_var, (0)::numeric)) AS righe_spesa',
       'COALESCE(v_ce_totale.logistica_var, (0)::numeric)) - COALESCE(( SELECT sum(cr.importo) FROM ce_rettifiche cr WHERE ((cr.attiva AND (cr.linea = ''logistica_var''::text)) AND (cr.year = v_ce_totale.year) AND (cr.month = v_ce_totale.month))), (0)::numeric) AS righe_spesa')
    ) v(vecchio, nuovo) loop
    if (length(def) - length(replace(def, r.vecchio, ''))) / length(r.vecchio) <> 1 then
      raise exception '0212: in v_ce_completezza "%" non compare esattamente una volta', r.vecchio;
    end if;
    def := replace(def, r.vecchio, r.nuovo);
  end loop;
  execute 'create or replace view public.v_ce_completezza as ' || def;
end $$;

------------------------------------------------------------------------------------------------ drill
-- COGS: le rettifiche come righe a parte, una per mese e canale (qty 0, codice fisso, motivo nell'item).
create or replace view public.v_ce_drill_cogs as
 SELECT li.year, li.month, 'online'::text AS canale, li.codice, p.item, p.variant, li.quantita AS qty,
    (- (li.cogs_snapshot * li.quantita)) AS costo, false AS is_gift
   FROM (shopify_line_items li LEFT JOIN products p ON ((p.codice = li.codice)))
  WHERE (li.codice_norm IS DISTINCT FROM 'GIFT_CARD'::text)
UNION ALL
 SELECT q.year, q.month, 'offline'::text, q.codice, q.item, q.variant, q.quantita, (- (q.cogs * q.quantita)), false
   FROM qromo_sales q
UNION ALL
 SELECT b.year, b.month, 'b2b'::text, b.codice, NULL::text, NULL::text, b.quantita, (- b.cogs), false
   FROM b2b_movements b
  WHERE ((b.tipo_movimento = 'venduto'::text) AND ((b.stato IS NULL) OR (b.stato <> 'annullato'::text)))
UNION ALL
 SELECT g.year, g.month, 'gift'::text, g.codice, g.item, g.variant, g.quantita, (- g.cogs), true
   FROM gifts_offline g
UNION ALL
 SELECT r.year, r.month,
    CASE WHEN r.in_amimi THEN 'rettifica'::text ELSE 'rettifica_gift'::text END,
    'RETTIFICA ' || r.gruppo || ' ' || r.canale, r.motivo, r.canale, 0::numeric, r.importo, NOT r.in_amimi
   FROM ce_rettifiche r
  WHERE r.attiva AND r.linea = 'cogs';

-- Spese: la logistica variabile rettificata come riga 'lvar' (categoria RETTIFICA, fuori dalle spese vere).
create or replace view public.v_ce_drill_expense as
select year, month, date_paid, operazione, categoria, sottocategoria, costo, amimi,
  case
    when categoria = 'SALARI' then 'sal'
    when categoria = 'TASSE' and sottocategoria = 'IVA' then null
    when categoria = 'TASSE' then 'tasse'
    when categoria = 'OPEX' then 'opex'
    when categoria = 'EVENTI' then 'ev'
    when categoria = 'MARKETING' then 'mkt'
    when categoria = 'LOGISTICA' and sottocategoria ilike 'sped%' then 'lvar'
    when categoria = 'LOGISTICA' then 'lmag'
    else null
  end as ce_line
from expenses e
where status = 'approved'
union all
select r.year, r.month, null::date, r.motivo, 'RETTIFICA'::text, r.gruppo, r.importo, r.in_amimi, 'lvar'::text
from ce_rettifiche r
where r.attiva and r.linea = 'logistica_var';

grant select on public.v_ce_drill_cogs, public.v_ce_drill_expense to anon, authenticated;

------------------------------------------------------------------------------------------------ 2) calcolo vivo
-- Delta COGS dei materiali per mese e canale. Regole (brief sez. 2, Dan 19 e 25-11, "nel dubbio sovrastimare"):
--  - per ogni lotto Prodotto Finito: manodopera del lotto + materiale per pezzo;
--  - pelle (Lea, Lea Maxi, Maria, Valentina, Sophie): EUR/m2 per famiglia, prima/dopo la data del rincaro, diviso la resa
--    (Lea 4, Maxi 2, Maria e Valentina 4, Sophie 3); Lea con manodopera >= 30 e Maxi >= 33 hanno gia' la pelle dentro;
--  - Annie +5, Agata +7 (tessuto); India (ordine del 25-03) +2,42 a pezzo = (425,07 + 1.015,42 + 185) / 672 pezzi;
--  - costo della vendita = media pesata dei lotti arrivati fino alla fine del mese, MAI sotto il costo gia' scritto;
--  - le vendite senza costo (cogs 0 o null: unresolved, custom item) restano fuori: il delta e' solo il materiale.
create or replace view public.v_ce_rettifica_cogs_materiali as
with lotti as (
  select b.codice_norm, b.data, b.quantita q, b.costo_unitario lab,
    case
      when b.codice_norm ~ '^(LEA_BAG|MARIA_BAG|VALENTINA_BAG|SOPHIE_BAG)' then
        case
          when b.codice_norm ~ '^LEA_BAG_MAXI' and b.costo_unitario >= 33 then 0
          when b.codice_norm ~ '^LEA_BAG' and b.codice_norm !~ '^LEA_BAG_MAXI' and b.costo_unitario >= 30 then 0
          else
            (case
              when b.codice_norm ~ '(PONY|ZEBRA|MUCCA|BAMBI|LEOPARD|CAVALLIN|GIRAFF|ASTRA)' then case when b.data >= date '2026-07-09' then 66 else 25 end
              when b.codice_norm ~ '(PATENT|VERNICE)' then case when b.data >= date '2026-09-21' then 40 else 10 end
              when b.codice_norm ~ '(SMOOTH|VITELLO)' then case when b.data >= date '2026-10-01' then 40 else 10 end
              when b.codice_norm ~ '(SUEDE|CAMOSCIO)' then case when b.data >= date '2026-10-07' then 21.30 else 10 end
              else case when b.data >= date '2026-09-22' then 12 else 10 end
            end)::numeric
            / case when b.codice_norm ~ '^LEA_BAG_MAXI' then 2 when b.codice_norm ~ '^SOPHIE_BAG' then 3 else 4 end
        end
      when b.codice_norm ~ '^ANNIE_BAG' then 5
      when b.codice_norm ~ '^AGATA_BAG' then 7
      when b.fornitore = 'India' and b.data = date '2026-03-25' then 2.42
      else 0
    end::numeric as mat,
    (b.fornitore = 'India' and b.data = date '2026-03-25') as india
  from purchases b
  where b.tipologia = 'Prodotto Finito' and b.quantita > 0 and b.costo_unitario > 0
    and coalesce(b.fornitore, '') !~* '^(RETTIFICA|RESO)'
),
vendite as (
  select 'online'::text canale, li.year, li.month, li.codice_norm, li.quantita q, li.cogs_snapshot c
    from shopify_line_items li where li.codice_norm is distinct from 'GIFT_CARD'
  union all
  select 'offline', q.year, q.month, q.codice_norm, q.quantita, q.cogs from qromo_sales q
  union all
  select 'b2b', b.year, b.month, b.codice_norm, b.quantita, b.cogs / nullif(b.quantita, 0)
    from b2b_movements b where b.tipo_movimento = 'venduto' and (b.stato is null or b.stato <> 'annullato')
  union all
  select 'gift', g.year, g.month, g.codice_norm, g.quantita, g.cogs / nullif(g.quantita, 0) from gifts_offline g
),
calc as (
  select v.canale, v.year, v.month, v.codice_norm, v.q,
    greatest(coalesce(n.nuovo, 0), v.c) - v.c as d_unit,
    n.india
  from vendite v
  left join lateral (
    select sum((l.lab + l.mat) * l.q) / nullif(sum(l.q), 0) as nuovo, bool_or(l.india) as india
    from lotti l
    where l.codice_norm = v.codice_norm
      and l.data <= (make_date(v.year, v.month, 1) + interval '1 month - 1 day')::date
  ) n on true
  where v.year is not null and v.q <> 0 and v.c > 0
)
select year, month, canale,
  round(- sum(d_unit * q), 2) as importo,                                    -- segno del CE
  round(- coalesce(sum(d_unit * q) filter (where india), 0), 2) as di_cui_india,
  sum(q) filter (where d_unit > 0) as pezzi_rettificati,
  count(distinct codice_norm) filter (where d_unit > 0) as codici
from calc
group by year, month, canale
having round(sum(d_unit * q), 2) <> 0;
grant select on public.v_ce_rettifica_cogs_materiali to authenticated;

------------------------------------------------------------------------------------------------ 3) imposte stimate
create table if not exists public.ce_imposte_aliquote (
  anno int primary key,
  ires numeric(6, 4) not null check (ires >= 0 and ires < 1),
  irap numeric(6, 4) not null check (irap >= 0 and irap < 1),
  note text,
  created_at timestamptz not null default now()
);
comment on table public.ce_imposte_aliquote is
  'Aliquote per la stima di IRES e IRAP nel CE (migr 0212). Da confermare con lo Studio CSSF. Scrittura solo via migrazione.';
insert into public.ce_imposte_aliquote (anno, ires, irap, note)
values (2026, 0.24, 0.039, 'Stima di prima battuta (Dan 25-11): IRES 24% sull''utile ante imposte progressivo, IRAP 3,9% su MC2 + salari. Da confermare con Sergio (Studio CSSF).')
on conflict (anno) do nothing;
alter table public.ce_imposte_aliquote enable row level security;
drop policy if exists ce_imposte_aliquote_read on public.ce_imposte_aliquote;
create policy ce_imposte_aliquote_read on public.ce_imposte_aliquote for select using (true);
grant select on public.ce_imposte_aliquote to anon, authenticated;

-- Accantonamento per competenza: imposta sul progressivo dell'anno (mai sotto zero) meno quella del mese prima.
-- Un mese in perdita restituisce parte dell'accantonamento dei mesi prima; il totale dell'anno e' l'imposta sul totale.
create or replace view public.v_ce_imposte_stimate as
with b as (
  select t.year, t.month, t.mc2 as utile_ante_imposte, t.mc2 - t.salari as base_irap,
         a.ires as aliquota_ires, a.irap as aliquota_irap
  from v_ce_totale t
  join ce_imposte_aliquote a on a.anno = t.year
),
p as (
  select b.*,
    sum(utile_ante_imposte) over w as utile_progressivo,
    sum(base_irap) over w as base_irap_progressiva
  from b
  window w as (partition by year order by month rows between unbounded preceding and current row)
),
c as (
  select p.*,
    aliquota_ires * greatest(utile_progressivo, 0) as ires_progressiva,
    aliquota_irap * greatest(base_irap_progressiva, 0) as irap_progressiva
  from p
)
select year, month, utile_ante_imposte, base_irap, utile_progressivo, base_irap_progressiva,
  aliquota_ires, aliquota_irap,
  round(-(ires_progressiva - coalesce(lag(ires_progressiva) over m, 0)), 2) as ires_stimata,
  round(-(irap_progressiva - coalesce(lag(irap_progressiva) over m, 0)), 2) as irap_stimata,
  round(utile_ante_imposte - (ires_progressiva - coalesce(lag(ires_progressiva) over m, 0))
                           - (irap_progressiva - coalesce(lag(irap_progressiva) over m, 0)), 2) as utile_dopo_imposte
from c
window m as (partition by year order by month);
grant select on public.v_ce_imposte_stimate to anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'ask_ro') then
    grant select on public.ce_imposte_aliquote, public.v_ce_imposte_stimate to ask_ro;
  end if;
end $$;

------------------------------------------------------------------------------------------------ guardia: CE identico
do $$
declare v_diff text;
begin
  if exists (select 1 from public.ce_rettifiche) then raise exception '0212: ce_rettifiche deve nascere vuota'; end if;
  select string_agg(s.ce || '-' || s.month || ' ' || k, ', ') into v_diff
    from ce_snapshots s
    join (select 'amimi'::text ce, year, month, to_jsonb(a) j from v_ce_amimi_summary a
          union all
          select 'totale', year, month, to_jsonb(t) from v_ce_totale t) l
      on l.ce = s.ce and l.year = s.year and l.month = s.month,
         jsonb_object_keys(s.snapshot) k
   where k not in ('year', 'month')
     and abs((l.j->>k)::numeric - (s.snapshot->>k)::numeric) > 0.005;
  if v_diff is not null then raise exception '0212: i mesi chiusi si muovono senza rettifiche: %', v_diff; end if;
end $$;
