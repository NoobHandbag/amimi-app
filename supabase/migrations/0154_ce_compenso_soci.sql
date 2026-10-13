-- 0154_ce_compenso_soci.sql (2026-10-13, richiesta owner: "aggiungi il 2,5% al conto economico", anche sui mesi chiusi)
--
-- COSA: nuova riga del CE "compenso_soci" = quota delle vendite nette che spetta ai soci per accordo. Oggi c'e' un
-- solo accordo: Dan, 2,5% delle vendite nette da gennaio 2026 (proposta nov 2025; compensazione col suo versamento
-- mancante concordata su Discord l'08-06-2026). E' un costo VARIABILE (proporzionale alle vendite, come le
-- commissioni): entra in MC1 e quindi in MC2.
--
-- PERCHE' CALCOLATA E NON RIGHE IN `expenses`: `expenses` sono i pagamenti dell'estratto conto (si caricano dal CBI e
-- si riconciliano col commercialista); questa e' una competenza che non muove cassa finche' il debito di Dan non e'
-- estinto, e dipende da vendite che cambiano (resi, Qromo in ritardo, correzioni). Righe fisse andrebbero ricalcolate
-- a mano ogni mese e sporcherebbero `v_ce_completezza` e i controlli di ce-guard sulle spese.
--
-- BASE = vendite nette REALI del perimetro: IVA esclusa, al netto dei resi, senza omaggi.
--   * v_ce_amimi: omni_netto + resi (il CE Amimi' non contiene gifts_offline).
--   * v_ce_totale: omni_netto + resi - omaggi. v_ce_totale mette in offline_lordo anche `gifts_offline.prezzo`, cioe'
--     il valore a listino degli OMAGGI (kind 'gift': 81 righe, 6.358 EUR lordi a ottobre): non sono vendite e non
--     generano 2,5%. Restano nella base le `vendita_manuale` e le righe senza `kind` (import dal Foglio: a giugno ci sono
--     vendite vere fra queste, "vendita offline mai registrata", "deve ancora pagare"; le altre sono rettifiche a 0 o
--     3 righe da 1 EUR). Il blocco manuale gen/feb (ce_totale_manual, vecchia ditta) e' gia' dentro omni_netto e resi
--     del Totale: entra, come da accordo "da gennaio". La cifra da compensare col versamento di Dan e' quella del TOTALE.
--   * base negativa (resi > vendite) -> compenso 0, mai un ricavo.
-- PARAMETRI in `ce_compensi_soci` (aliquota, dal, al): fine accordo = valorizzare `al` (ultimo mese che matura);
-- rollback totale = cancellare la riga. In entrambi i casi i mesi chiusi toccati vanno RI-chiusi (il compenso cambia mc2).
--
-- METODO: le viste NON vengono ribattute a mano (lezione 0093). v_ce_amimi e v_ce_totale si avvolgono nella loro
-- stessa definizione (pg_get_viewdef): le colonne esistenti restano identiche e nello stesso ordine, mc1/mc2 del Totale
-- vengono ricalcolate aggiungendo il compenso, e le due colonne nuove (base_compenso_soci, compenso_soci) vanno in
-- coda (Postgres non permette di inserirle in mezzo con CREATE OR REPLACE). Le due *_summary si riscrivono intere
-- perche' sono un SELECT di una riga.
--
-- MESI CHIUSI (gen-giu 2026, entrambi i CE): OK owner esplicito del 13-10 ("I am fine with changing closed months").
-- La ri-chiusura qui sotto e' una PATCH: nello snapshot cambiano solo mc1, mc2 e le due colonne nuove, il resto resta
-- com'era. Motivo (Gate 2, finding B1): a giugno, in entrambi i CE, 533,50 EUR sono passati da OPEX a SALARI il 09-10
-- (change_log 1741, ricodifica a mese chiuso); mc2 non cambia, quindi una ri-chiusura "copia tutto il live" l'avrebbe
-- congelata senza che nessuno l'avesse decisa. Guardia: netto identico e mc1/mc2 scesi ESATTAMENTE del compenso.

------------------------------------------------------------------------------------------------ parametri
create table if not exists public.ce_compensi_soci (
  id bigserial primary key,
  socio text not null,
  aliquota numeric(7,5) not null check (aliquota > 0 and aliquota < 0.5),
  dal date not null check (extract(day from dal) = 1),
  al date check (al is null or al >= dal),
  note text,
  created_at timestamptz not null default now(),
  unique (socio, dal)
);
comment on table public.ce_compensi_soci is
  'Accordi di compenso dei soci in % delle vendite nette (riga compenso_soci del CE, migr 0154). Scrittura solo via migrazione.';

insert into public.ce_compensi_soci (socio, aliquota, dal, note)
select 'Dan', 0.025, date '2026-01-01',
       'Proposta nov 2025: 2,5% delle vendite nette da gennaio 2026. Compensazione col versamento mancante concordata su Discord #generale 08-06-2026.'
where not exists (select 1 from public.ce_compensi_soci where socio = 'Dan' and dal = date '2026-01-01');

grant select on public.ce_compensi_soci to anon, authenticated;

-- Somma delle aliquote attive nel mese (0 se nessun accordo). STABLE, SECURITY DEFINER con search_path fisso: le viste
-- CE la chiamano anche come ask_ro (ask-data, assistant, MCP), che non deve aver bisogno di un grant sulla tabella.
create or replace function public.ce_aliquota_compensi(p_year int, p_month int)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(c.aliquota), 0)
  from public.ce_compensi_soci c
  where make_date(p_year, p_month, 1) >= c.dal
    and (c.al is null or make_date(p_year, p_month, 1) <= c.al)
$$;
grant execute on function public.ce_aliquota_compensi(int, int) to anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'ask_ro') then
    grant select on public.ce_compensi_soci to ask_ro;
    grant execute on function public.ce_aliquota_compensi(int, int) to ask_ro;
  end if;
end $$;

------------------------------------------------------------------------------------------------ viste CE
do $$
declare
  d text;
  n int;
begin
  -- guardia: le viste devono essere quelle attese (nessuna colonna compenso gia' presente)
  select count(*) into n from information_schema.columns
   where table_schema = 'public' and table_name in ('v_ce_amimi','v_ce_totale','v_ce_amimi_summary','v_ce_totale_summary')
     and column_name in ('compenso_soci','base_compenso_soci');
  if n <> 0 then raise exception '0154: colonne compenso gia'' presenti (% occorrenze): migrazione gia'' applicata?', n; end if;

  ---------------------------------------------------------------- v_ce_amimi (niente mc1/mc2 qui: stanno nella summary)
  d := rtrim(pg_get_viewdef('public.v_ce_amimi'::regclass, true), E' \n;');
  execute 'create or replace view public.v_ce_amimi as
    select x.*,
           greatest(x.omni_netto + x.resi, 0) as base_compenso_soci,
           - public.ce_aliquota_compensi(x.year, x.month) * greatest(x.omni_netto + x.resi, 0) as compenso_soci
    from (' || d || ') x';

  ---------------------------------------------------------------- v_ce_totale (ha gia'' mc1/mc2: si ricalcolano)
  d := rtrim(pg_get_viewdef('public.v_ce_totale'::regclass, true), E' \n;');
  execute 'create or replace view public.v_ce_totale as
    select t.year, t.month, t.online_lordo, t.online_netto, t.online_pezzi, t.offline_lordo, t.offline_netto, t.offline_pezzi,
           t.b2b_lordo, t.b2b_netto, t.b2b_pezzi, t.omni_netto, t.cogs, t.packaging, t.commissioni, t.logistica_var, t.resi,
           t.salari, t.tasse, t.logistica_mag, t.opex, t.eventi, t.marketing,
           t.mc1 + c.compenso_soci as mc1,
           t.mc2 + c.compenso_soci as mc2,
           c.base_compenso_soci,
           c.compenso_soci
    from (' || d || ') t
    cross join lateral (
      select b.base as base_compenso_soci,
             - public.ce_aliquota_compensi(t.year, t.month) * b.base as compenso_soci
      from (select greatest(
                     t.omni_netto + t.resi
                     - coalesce((select sum(g.prezzo) from public.gifts_offline g
                                  where g.year = t.year and g.month = t.month
                                    and g.kind = ''gift''), 0) / 1.22,
                     0) as base) b
    ) c';
end $$;

create or replace view public.v_ce_amimi_summary as
 SELECT year, month, online_lordo, online_netto, online_pezzi, offline_lordo, offline_netto, offline_pezzi,
    b2b_lordo, b2b_netto, b2b_pezzi, omni_netto, cogs, packaging, commissioni, logistica_var, resi,
    salari, tasse, logistica_mag, opex, eventi, marketing,
    omni_netto + cogs + packaging + commissioni + logistica_var + resi + compenso_soci AS mc1,
    omni_netto + cogs + packaging + commissioni + logistica_var + resi + compenso_soci + salari + tasse + logistica_mag + opex + eventi + marketing AS mc2,
    base_compenso_soci,
    compenso_soci
   FROM v_ce_amimi;

create or replace view public.v_ce_totale_summary as
 SELECT year, month, online_lordo, online_netto, online_pezzi, offline_lordo, offline_netto, offline_pezzi,
    b2b_lordo, b2b_netto, b2b_pezzi, omni_netto, cogs, packaging, commissioni, logistica_var, resi,
    salari, tasse, logistica_mag, opex, eventi, marketing,
    omni_netto + cogs + packaging + commissioni + logistica_var + resi + compenso_soci AS mc1,
    omni_netto + cogs + packaging + commissioni + logistica_var + resi + compenso_soci + salari + tasse + logistica_mag + opex + eventi + marketing AS mc2,
    base_compenso_soci,
    compenso_soci
   FROM v_ce_totale;

grant select on public.v_ce_amimi, public.v_ce_amimi_summary, public.v_ce_totale, public.v_ce_totale_summary to anon, authenticated;

------------------------------------------------------------------------------------------------ controlli d'identita'
do $$
declare v_bad int;
begin
  -- mc1/mc2 del Totale (vista) e della sua summary devono coincidere al centesimo
  select count(*) into v_bad from v_ce_totale t join v_ce_totale_summary s using (year, month)
   where abs(t.mc1 - s.mc1) > 0.01 or abs(t.mc2 - s.mc2) > 0.01;
  if v_bad <> 0 then raise exception '0154: v_ce_totale e v_ce_totale_summary divergono su mc1/mc2 (% mesi)', v_bad; end if;

  -- compenso = -aliquota x base, mai positivo
  select count(*) into v_bad from (
    select year, month, compenso_soci, base_compenso_soci from v_ce_amimi_summary
    union all select year, month, compenso_soci, base_compenso_soci from v_ce_totale) z
   where z.compenso_soci > 0
      or abs(z.compenso_soci + public.ce_aliquota_compensi(z.year, z.month) * z.base_compenso_soci) > 0.005;
  if v_bad <> 0 then raise exception '0154: compenso_soci incoerente con aliquota x base (% righe)', v_bad; end if;
end $$;

------------------------------------------------------------------------------------------------ ri-chiusura mesi chiusi
-- Prima: per ogni mese chiuso il netto e' identico e mc1/mc2 sono scesi esattamente del compenso. Altrimenti stop.
create temp table _ce0154 on commit drop as
select s.id, s.ce, s.year, s.month, s.snapshot, s.closed_at, s.closed_by, l.omni_netto, l.mc1, l.mc2, l.base_compenso_soci, l.compenso_soci
  from ce_snapshots s
  join (select 'amimi'::text ce, year, month, omni_netto, mc1, mc2, base_compenso_soci, compenso_soci from v_ce_amimi_summary
        union all
        select 'totale', year, month, omni_netto, mc1, mc2, base_compenso_soci, compenso_soci from v_ce_totale) l
    on l.ce = s.ce and l.year = s.year and l.month = s.month;

do $$
declare v_bad int; v_tot int; v_n int;
begin
  select count(*) into v_tot from ce_snapshots;
  select count(*) into v_n from _ce0154;
  if v_n <> v_tot then raise exception '0154: % snapshot senza riga live corrispondente', v_tot - v_n; end if;
  select count(*) into v_bad from _ce0154
   where abs(omni_netto - (snapshot->>'omni_netto')::numeric) > 0.01
      or abs((mc1 - (snapshot->>'mc1')::numeric) - compenso_soci) > 0.01
      or abs((mc2 - (snapshot->>'mc2')::numeric) - compenso_soci) > 0.01;
  if v_bad <> 0 then
    raise exception '0154: reclose annullato, % mesi chiusi su % non si muovono del solo compenso (netto/mc1/mc2)', v_bad, v_tot;
  end if;
end $$;

-- audit: before (snapshot + vecchi closed_at/closed_by) e after in change_log PRIMA della sovrascrittura
insert into change_log (tbl, row_id, op, before, after, chi, source)
select 'ce_snapshots', ce || '-' || year || '-' || month, 'reclose',
       snapshot || jsonb_build_object('_closed_at', closed_at, '_closed_by', closed_by),
       snapshot || jsonb_build_object('mc1', mc1, 'mc2', mc2, 'base_compenso_soci', base_compenso_soci, 'compenso_soci', compenso_soci),
       'reclose-compenso-soci-2026-10-13', 'claude-code-migration'
  from _ce0154;

update ce_snapshots s
   set snapshot = s.snapshot || jsonb_build_object('mc1', t.mc1, 'mc2', t.mc2, 'base_compenso_soci', t.base_compenso_soci, 'compenso_soci', t.compenso_soci),
       closed_at = now(), closed_by = 'claude-code (0154: compenso soci 2,5%, OK owner 13-10)'
  from _ce0154 t
 where s.id = t.id;

do $$
declare v_bad int;
begin
  select count(*) into v_bad from v_ce_drift where abs(delta_netto) > 0.01 or abs(delta_mc2) > 0.01;
  if v_bad <> 0 then raise exception '0154: dopo la ri-chiusura restano % mesi in drift', v_bad; end if;
  select count(*) into v_bad from ce_snapshots where not (snapshot ? 'compenso_soci');
  if v_bad <> 0 then raise exception '0154: % snapshot senza compenso_soci dopo la ri-chiusura', v_bad; end if;
end $$;
