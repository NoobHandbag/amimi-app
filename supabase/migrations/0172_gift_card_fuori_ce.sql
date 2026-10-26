-- 0172_gift_card_fuori_ce.sql (2026-10-26, OK owner in chat: "build the gift-card fix (point F)")
--
-- COSA: la VENDITA di una gift card esce dal CE. Regola owner del 13-09: il ricavo si conta quando la card viene spesa,
-- perche' l'ordine pagato con la card ha gia' i prodotti a prezzo pieno; contarla anche all'acquisto = doppio ricavo.
-- Era il punto F del brief dedup del 13-09 (done/2026-09-13_CLAUDE_CODE_BRIEF_dedup_shopify_orders_fix_sync.md), mai
-- eseguito: CASI_APERTI n.18, e la riga "Vendite Shopify non agganciate a un prodotto" rossa da fine agosto.
--
-- PERCHE' ORA: le gift card vendute sono #1663 (20-08, 2 x 50,00) e #1877 (10-10, 1 x 50,00), e risultano gia' spese:
-- #1682 (26-08) ha due transazioni gift_card da 50,00 e #1937 (22-10) una da 50,00 (Shopify, letto il 26-10; l'identita'
-- delle card non e' leggibile, il token non ha read_gift_cards). Oggi il CE conta quei 150,00 EUR lordi due volte:
-- agosto +100,00, ottobre +50,00. I mesi chiusi (gen-giu) non hanno righe gift card: nessun drift, nessuna ri-chiusura.
--
-- PASSI
--  1. non_product_codici: + ORDINE_TEST (ordini di prova con voce personalizzata, es. #1781 del collaudo Premia).
--  2. product_aliases: i 3 alias del seed (nomi in mojibake) puntavano a 'GIFT_CARD_', codice che non esiste -> GIFT_CARD;
--     + alias sul nome base 'GIFT CARD Amimi' con la i accentata -> GIFT_CARD (il resolver prova il titolo prima di
--     " - ", quindi copre ogni taglio). shopify-sync v9 guarda per primo il flag gift_card della riga: l'alias e' il ripiego.
--  3. shopify_line_items: le 2 righe gift card -> GIFT_CARD, la riga di #1781 -> ORDINE_TEST; resolved = true e
--     cogs_snapshot = 0 (ne' una gift card ne' un ordine di prova hanno costo prodotto; con NULL accenderebbero
--     ce_cogs_mancanti). Before/after in change_log. Le righe gia' importate non vengono mai ri-risolte da shopify-sync
--     (inserisce solo ordini nuovi e il resync dei 45 giorni tocca solo rimborsi e stati): il ripuntamento resta.
--  4. viste CE (v_ce_amimi, v_ce_totale, v_ce_drill_sales, v_ce_drill_cogs): le righe GIFT_CARD escono da vendite, pezzi
--     e costi per pezzo. Restano commissioni, sconti, spedizione e il conteggio ordini (1 EUR di packaging per ordine)
--     dell'ordine che contiene la card. #1781 resta nel CE: vendita 50,00 e rimborso 50,00, netto 0.
--     METODO (lezione 0093, come la 0154): le viste NON si ribattono a mano. Si prende pg_get_viewdef e si aggiunge il
--     filtro in UN punto per vista, con guardia "esattamente un'occorrenza" del testo da sostituire.
--  5. Controlli: per ogni mese e per entrambi i CE cambiano SOLO online_lordo, online_netto, omni_netto (meno le vendite
--     gift card), online_pezzi (meno i pezzi), packaging (+3,71 per pezzo) e di conseguenza base e compenso soci, mc1, mc2;
--     nessun nuovo drift sui mesi chiusi; shopify_orphan = 0; ce_cogs_mancanti invariato.
-- Rollback (before di ogni riga in change_log, chi = gift-card-fuori-ce-2026-10-26): (a) rimettere codice NULL, resolved
-- false, cogs_snapshot NULL sulle 3 righe (op gift_card_fuori_ce); (b) riportare i 3 alias del seed a 'GIFT_CARD_' e
-- cancellare l'alias nuovo (op gift_card_alias); (c) togliere ORDINE_TEST da non_product_codici; (d) togliere il filtro
-- dalle 4 viste con lo stesso metodo (pg_get_viewdef + sostituzione guardata) e da supabase/schema.sql; (e) shopify-sync
-- torna alla v8. Senza (b) ed (e) la prossima gift card verrebbe comunque risolta su GIFT_CARD.
-- Limiti accettati (Gate 2 del 26-10, CASI_APERTI n.18): un RIMBORSO di una gift card resta nei resi (vendita esclusa,
-- rimborso no: il mese perderebbe ricavo che non aveva mai contato; oggi nessun rimborso); l'ordine che contiene solo
-- gift card conta ancora 1 EUR di packaging; vendite gift card su Qromo restano nel CE (mai successo: zero righe
-- GIFT_CARD in qromo_sales); viste di analisi fuori dal CE (margini, movimenti 14 gg, digest) le contano ancora.

begin;

------------------------------------------------------------------------------------------------ guardie di stato
do $$
declare v_n int;
begin
  if not exists (select 1 from public.non_product_codici where codice = 'GIFT_CARD') then
    raise exception '0172: GIFT_CARD non e'' in non_product_codici';
  end if;
  select count(*) into v_n from public.shopify_line_items
   where shopify_line_id in (19735845830983, 20142967816519, 19960503730503) and codice is null;
  if v_n <> 3 then raise exception '0172: attese 3 righe senza codice (#1663, #1877, #1781), trovate %', v_n; end if;
  select count(*) into v_n from public.shopify_line_items
   where (lineitem_name ilike '%gift card%' or codice_norm = 'GIFT_CARD')
     and shopify_line_id not in (19735845830983, 20142967816519);
  if v_n <> 0 then raise exception '0172: % righe gift card non previste (mesi chiusi?): fermarsi e guardarle', v_n; end if;
  select count(*) into v_n from public.product_aliases where codice = 'GIFT_CARD_';
  if v_n <> 3 then raise exception '0172: attesi 3 alias GIFT_CARD_ del seed, trovati %', v_n; end if;
end $$;

------------------------------------------------------------------------------------------------ fotografia prima
create temp table _ce0172 on commit drop as
select 'amimi'::text as ce, s.* from public.v_ce_amimi_summary s
union all
select 'totale', t.* from public.v_ce_totale t;

create temp table _gc0172 on commit drop as
select year, month, sum(quantita) as q, sum(price * quantita) as v
  from public.shopify_line_items
 where shopify_line_id in (19735845830983, 20142967816519)
 group by year, month;

create temp table _chk0172 on commit drop as
select (select count(*) from public.v_ce_drift where abs(delta_netto) > 0.01 or abs(delta_mc2) > 0.01) as drift,
       (select count(*) from public.shopify_line_items where codice is not null and cogs_snapshot is null) as no_cogs;

do $$
declare v_q numeric; v_v numeric;
begin
  select sum(q), sum(v) into v_q, v_v from _gc0172;
  if v_q is distinct from 3 or v_v is distinct from 150 then
    raise exception '0172: righe gift card attese 3 pezzi / 150,00 EUR, trovate % / %', v_q, v_v;
  end if;
end $$;

------------------------------------------------------------------------------------------------ 1. codice non-prodotto
insert into public.non_product_codici (codice) values ('ORDINE_TEST') on conflict do nothing;

------------------------------------------------------------------------------------------------ 2. alias
insert into public.change_log (tbl, row_id, op, before, after, chi, source)
select 'product_aliases', a.id::text, 'gift_card_alias',
       jsonb_build_object('shopify_name', a.shopify_name, 'codice', a.codice),
       jsonb_build_object('shopify_name', a.shopify_name, 'codice', 'GIFT_CARD'),
       'gift-card-fuori-ce-2026-10-26', 'claude-code-migration'
  from public.product_aliases a
 where a.codice = 'GIFT_CARD_';

update public.product_aliases set codice = 'GIFT_CARD' where codice = 'GIFT_CARD_';

-- U&'...\00EC' = la i accentata di Amimi, scritta in escape perche' il file resti ASCII
with ins as (
  insert into public.product_aliases (shopify_name, codice, source)
  select U&'GIFT CARD Amim\00EC', 'GIFT_CARD', 'claude-code-0172'
   where not exists (select 1 from public.product_aliases
                      where shopify_name_norm = upper(regexp_replace(U&'GIFT CARD Amim\00EC', '\s+', '_', 'g')))
  returning id, shopify_name, codice
)
insert into public.change_log (tbl, row_id, op, before, after, chi, source)
select 'product_aliases', ins.id::text, 'gift_card_alias', null,
       jsonb_build_object('shopify_name', ins.shopify_name, 'codice', ins.codice),
       'gift-card-fuori-ce-2026-10-26', 'claude-code-migration'
  from ins;

------------------------------------------------------------------------------------------------ 3. righe d'ordine
create temp table _rip0172 on commit drop as
select * from (values (19735845830983::bigint, 'GIFT_CARD'::text),   -- #1663, 2 x GIFT CARD 50,00
                      (20142967816519::bigint, 'GIFT_CARD'::text),   -- #1877, 1 x GIFT CARD 50,00
                      (19960503730503::bigint, 'ORDINE_TEST'::text)  -- #1781, TEST LOYALTY PREMIA, rimborsato
              ) x(lid, codice);

insert into public.change_log (tbl, row_id, op, before, after, chi, source)
select 'shopify_line_items', li.id::text, 'gift_card_fuori_ce',
       jsonb_build_object('order_id', li.order_id, 'shopify_line_id', li.shopify_line_id, 'codice', li.codice,
                          'resolved', li.resolved, 'cogs_snapshot', li.cogs_snapshot),
       jsonb_build_object('order_id', li.order_id, 'shopify_line_id', li.shopify_line_id, 'codice', r.codice,
                          'resolved', true, 'cogs_snapshot', 0),
       'gift-card-fuori-ce-2026-10-26', 'claude-code-migration'
  from public.shopify_line_items li
  join _rip0172 r on r.lid = li.shopify_line_id
 where li.codice is null;

do $$
declare v_n int;
begin
  update public.shopify_line_items li
     set codice = r.codice, resolved = true, cogs_snapshot = 0
    from _rip0172 r
   where li.shopify_line_id = r.lid and li.codice is null;
  get diagnostics v_n = row_count;
  if v_n <> 3 then raise exception '0172: ripuntate % righe invece di 3', v_n; end if;
end $$;

------------------------------------------------------------------------------------------------ 4. viste CE
do $$
declare
  v_d text;
  v_n int;
  v_filtro constant text := ' WHERE shopify_line_items.codice_norm IS DISTINCT FROM ''GIFT_CARD''::text';
  v_pat text;
begin
  -- v_ce_amimi e v_ce_totale: la CTE sl (vendite, pezzi e COGS online per mese)
  v_pat := '(FROM shopify_line_items)(\s+GROUP BY shopify_line_items\.year, shopify_line_items\.month)';

  v_d := rtrim(pg_get_viewdef('public.v_ce_amimi'::regclass, true), E' \n;');
  select count(*) into v_n from regexp_matches(v_d, v_pat, 'g');
  if v_n <> 1 then raise exception '0172: v_ce_amimi, CTE sl trovata % volte invece di 1', v_n; end if;
  execute 'create or replace view public.v_ce_amimi as ' || regexp_replace(v_d, v_pat, '\1' || v_filtro || '\2');

  v_d := rtrim(pg_get_viewdef('public.v_ce_totale'::regclass, true), E' \n;');
  select count(*) into v_n from regexp_matches(v_d, v_pat, 'g');
  if v_n <> 1 then raise exception '0172: v_ce_totale, CTE sl trovata % volte invece di 1', v_n; end if;
  execute 'create or replace view public.v_ce_totale as ' || regexp_replace(v_d, v_pat, '\1' || v_filtro || '\2');

  -- v_ce_drill_sales: il lordo online per ordine
  v_pat := '(FROM shopify_line_items)(\s+GROUP BY shopify_line_items\.order_id)';
  v_d := rtrim(pg_get_viewdef('public.v_ce_drill_sales'::regclass, true), E' \n;');
  select count(*) into v_n from regexp_matches(v_d, v_pat, 'g');
  if v_n <> 1 then raise exception '0172: v_ce_drill_sales, somma per ordine trovata % volte invece di 1', v_n; end if;
  execute 'create or replace view public.v_ce_drill_sales as ' || regexp_replace(v_d, v_pat, '\1' || v_filtro || '\2');

  -- v_ce_drill_cogs: il ramo online (alias li)
  v_pat := '(FROM shopify_line_items li\s+LEFT JOIN products p ON p\.codice = li\.codice)';
  v_d := rtrim(pg_get_viewdef('public.v_ce_drill_cogs'::regclass, true), E' \n;');
  select count(*) into v_n from regexp_matches(v_d, v_pat, 'g');
  if v_n <> 1 then raise exception '0172: v_ce_drill_cogs, ramo online trovato % volte invece di 1', v_n; end if;
  execute 'create or replace view public.v_ce_drill_cogs as '
       || regexp_replace(v_d, v_pat, '\1 WHERE li.codice_norm IS DISTINCT FROM ''GIFT_CARD''::text');
end $$;

------------------------------------------------------------------------------------------------ 5. controlli
do $$
declare v_bad int; v_n int;
begin
  -- ogni mese, entrambi i CE: si muove solo cio' che dipende dalle vendite gift card, ed esattamente di quelle
  select count(*) into v_bad
    from _ce0172 b
    join (select 'amimi'::text as ce, s.* from public.v_ce_amimi_summary s
          union all
          select 'totale', t.* from public.v_ce_totale t) a using (ce, year, month)
    left join _gc0172 g using (year, month)
   where abs((a.online_lordo - b.online_lordo) + coalesce(g.v, 0)) > 0.005
      or abs((a.online_netto - b.online_netto) + coalesce(g.v, 0) / 1.22) > 0.005
      or abs((a.omni_netto - b.omni_netto) + coalesce(g.v, 0) / 1.22) > 0.005
      or abs((a.online_pezzi - b.online_pezzi) + coalesce(g.q, 0)) > 0.005
      or abs((a.packaging - b.packaging) - 3.71 * coalesce(g.q, 0)) > 0.005
      -- la base del compenso scende al massimo del netto gift card (meno se era gia' vicina a zero), mai sale
      or (a.base_compenso_soci - b.base_compenso_soci) > 0.005
      or (a.base_compenso_soci - b.base_compenso_soci) < - coalesce(g.v, 0) / 1.22 - 0.005
      or abs(a.compenso_soci + public.ce_aliquota_compensi(a.year, a.month) * a.base_compenso_soci) > 0.005
      or abs((a.mc1 - b.mc1) - ((a.omni_netto - b.omni_netto) + (a.packaging - b.packaging) + (a.compenso_soci - b.compenso_soci))) > 0.005
      or abs((a.mc2 - b.mc2) - (a.mc1 - b.mc1)) > 0.005
      or a.offline_lordo <> b.offline_lordo or a.offline_netto <> b.offline_netto or a.offline_pezzi <> b.offline_pezzi
      or a.b2b_lordo <> b.b2b_lordo or a.b2b_netto <> b.b2b_netto or a.b2b_pezzi <> b.b2b_pezzi
      or a.cogs <> b.cogs or a.commissioni <> b.commissioni or a.logistica_var <> b.logistica_var or a.resi <> b.resi
      or a.salari <> b.salari or a.tasse <> b.tasse or a.logistica_mag <> b.logistica_mag or a.opex <> b.opex
      or a.eventi <> b.eventi or a.marketing <> b.marketing;
  if v_bad <> 0 then raise exception '0172: % righe CE (mese x CE) cambiate oltre le sole vendite gift card', v_bad; end if;

  select count(*) into v_n from _ce0172;
  select count(*) into v_bad from (select 'amimi'::text as ce, year, month from public.v_ce_amimi_summary
                                   union all select 'totale', year, month from public.v_ce_totale) z;
  if v_n <> v_bad then raise exception '0172: mesi nel CE prima % dopo %', v_n, v_bad; end if;

  -- attesi: agosto -100,00 e ottobre -50,00 lordi online in entrambi i CE
  select count(*) into v_bad
    from _ce0172 b
    join (select 'amimi'::text as ce, s.* from public.v_ce_amimi_summary s
          union all
          select 'totale', t.* from public.v_ce_totale t) a using (ce, year, month)
   where (year, month) in ((2026, 8), (2026, 10))
     and abs((b.online_lordo - a.online_lordo) - case month when 8 then 100 else 50 end) <= 0.005;
  if v_bad <> 4 then raise exception '0172: attese 4 righe (2 mesi x 2 CE) col lordo online sceso di 100/50, trovate %', v_bad; end if;

  -- mesi chiusi: nessun drift nuovo
  select count(*) into v_bad from public.v_ce_drift where abs(delta_netto) > 0.01 or abs(delta_mc2) > 0.01;
  select drift into v_n from _chk0172;
  if v_bad <> v_n then raise exception '0172: mesi chiusi in drift prima % dopo %', v_n, v_bad; end if;

  -- detector: nessuna vendita Shopify orfana, nessuna riga risolta senza COGS in piu'
  select n into v_bad from public.v_health where k = 'shopify_orphan';
  if v_bad <> 0 then raise exception '0172: shopify_orphan = % dopo il ripuntamento', v_bad; end if;
  select count(*) into v_bad from public.shopify_line_items where codice is not null and cogs_snapshot is null;
  select no_cogs into v_n from _chk0172;
  if v_bad <> v_n then raise exception '0172: righe risolte senza COGS prima % dopo %', v_n, v_bad; end if;

  -- drill coerenti col CE: il lordo online di agosto e ottobre nel drill = quello della vista
  select count(*) into v_bad
    from public.v_ce_amimi c
    join (select year, month, sum(lordo) as lordo from public.v_ce_drill_sales where canale = 'online' group by 1, 2) d
      using (year, month)
   where (year, month) in ((2026, 8), (2026, 10)) and abs(c.online_lordo - d.lordo) > 0.005;
  if v_bad <> 0 then raise exception '0172: v_ce_drill_sales non torna con v_ce_amimi su agosto/ottobre (% mesi)', v_bad; end if;
end $$;

commit;
