-- 0197_giovanni_b2b.sql (2026-11-18): Giovanni entra nel team come responsabile del B2B (Dan in chat, 18-11). Fa outreach
-- quasi solo per email, entra con il login condiviso info@amimi.it e le email partono come oggi da wholesale@amimi.it
-- (alias sendAs di info@, lead-outreach), ma firmate da lui e non piu' da Benedetta. Numero 0197: massimo fra origin/main,
-- i branch attivi e la produzione al 18-11 = 0196.
--
-- 1) push_*: la quarta persona `Giovanni` (chiave di PEOPLE del web) nei due check che elencano le persone, e i temi
--    `negozi` (un negozio contattato risponde) e `riepilogo` (riepilogo serale, per lui la sola riga B2B: push-eventi v12)
--    spuntati per lui alla prima iscrizione del telefono. Nessun telefono cambia: oggi lui non ne ha.
-- 2) lead_*: firma nuova in app_flags.lead_firma (nome e telefono di Giovanni, numero dato da Dan il 18-11), i tre template
--    che dicono "sono Benedetta" / "I'm Benedetta" e chi_default dei nove template a `Giovanni`, il telefono di contatto
--    wholesale nella voce 2 di lead_knowledge (la stessa che l'AI usa per le risposte), e le bozze ancora `proposta`
--    scritte con la firma vecchia (al 18-11 sono 5: in 2 c'e' anche "sono Benedetta" nel corpo). In una bozza "Gentile
--    Benedetta" e' la referente del negozio e resta. Nella voce 2 resta "oppure Benedetta passa in negozio": chi va in
--    negozio non e' stato deciso.
--
-- Non tocca il core (CE, stock, vendite): solo moduli push_* e lead_* e la chiave di configurazione lead_firma. Ogni riga
-- cambiata ha la sua riga in change_log (source 'migr 0197'); per le bozze solo id e sostituzioni, mai il testo.
-- Rollback: le stesse sostituzioni al contrario (firma nuova -> vecchia, "sono Giovanni di Amim" -> "sono Benedetta di
-- Amim", "I'm Giovanni from Amim" -> "I'm Benedetta from Amim", chi_default a 'Benedetta' tranne boutique_it 0 a 'Benny',
-- telefono della voce 2), 'Giovanni' tolto da predefinito_per e i due check come nella 0166/0163 (prima pero' vanno tolte
-- le iscrizioni con chi 'Giovanni'). Nessun `return` nei blocchi DO (MIG-C2 della 0166); variabili v_*
-- (plpgsql.variable_conflict = error in produzione).
begin;

-- 0) i valori attesi PRIMA: se qualcuno li ha cambiati nel frattempo la migrazione si ferma invece di indovinare
do $$
declare
  v_firma text := (select value from app_flags where key = 'lead_firma');
begin
  if v_firma is distinct from E'Benedetta - Amimì Milano\nwholesale@amimi.it - +39 333 280 8226 - P.IVA 14559580965' then
    raise exception '0197: lead_firma non e'' quella attesa, fermo';
  end if;
  if (select count(*) from lead_sequences where corpo like '%sono Benedetta di Amim%' or corpo like '%I''m Benedetta from Amim%') <> 3 then
    raise exception '0197: attesi 3 template che nominano Benedetta';
  end if;
  if (select count(*) from lead_knowledge where id = 2 and contenuto like '%telefono +39 333 280 8226%') <> 1 then
    raise exception '0197: la voce 2 di lead_knowledge non ha il telefono atteso';
  end if;
  perform set_config('amimi.g0197_push_enabled_prima', coalesce((select value from app_flags where key = 'push_enabled'), '<assente>'), true);
  perform set_config('amimi.g0197_iscritti_prima', (select count(*)::text from push_subscriptions), true);
end $$;

-- 1) push: i due check con la quarta persona
alter table push_subscriptions drop constraint push_subscriptions_chi_ck;
alter table push_subscriptions add constraint push_subscriptions_chi_ck check (chi in ('Ale', 'Bene', 'Ginevra', 'Giovanni'));
alter table push_temi drop constraint push_temi_predefinito_per_ck;
alter table push_temi add constraint push_temi_predefinito_per_ck check (predefinito_per <@ array['Ale', 'Bene', 'Ginevra', 'Giovanni']::text[]);

with agg as (
  update push_temi t set predefinito_per = t.predefinito_per || array['Giovanni']
   where t.key in ('negozi', 'riepilogo') and not ('Giovanni' = any(t.predefinito_per))
  returning t.key, t.predefinito_per
)
insert into change_log (tbl, row_id, op, before, after, chi, source)
select 'push_temi', a.key, 'predefinito_per', jsonb_build_object('predefinito_per', array_remove(a.predefinito_per, 'Giovanni')),
       jsonb_build_object('predefinito_per', a.predefinito_per), 'claude-code', 'migr 0197'
  from agg a;

-- 2) firma
insert into change_log (tbl, row_id, op, before, after, chi, source)
select 'app_flags', 'lead_firma', 'update', jsonb_build_object('value', value),
       jsonb_build_object('value', E'Giovanni - Amimì Milano\nwholesale@amimi.it - +39 348 918 8037 - P.IVA 14559580965'), 'claude-code', 'migr 0197'
  from app_flags where key = 'lead_firma';
update app_flags set value = E'Giovanni - Amimì Milano\nwholesale@amimi.it - +39 348 918 8037 - P.IVA 14559580965'
 where key = 'lead_firma';

-- 3) template: chi si presenta e chi_default
with agg as (
  update lead_sequences s
     set corpo = replace(replace(s.corpo, 'sono Benedetta di Amim', 'sono Giovanni di Amim'), 'I''m Benedetta from Amim', 'I''m Giovanni from Amim'),
         chi_default = 'Giovanni', updated_at = now()
   where s.corpo like '%Benedetta%' or s.chi_default is distinct from 'Giovanni'
  returning s.id, s.codice, s.tocco, md5(s.corpo) as md5_dopo
)
insert into change_log (tbl, row_id, op, before, after, chi, source)
select 'lead_sequences', a.id::text, 'update', jsonb_build_object('codice', a.codice, 'tocco', a.tocco),
       jsonb_build_object('chi_default', 'Giovanni', 'md5_corpo', a.md5_dopo), 'claude-code', 'migr 0197'
  from agg a;

-- 4) lead_knowledge voce 2: il telefono di contatto wholesale e' quello della firma
with agg as (
  update lead_knowledge k set contenuto = replace(k.contenuto, 'telefono +39 333 280 8226', 'telefono +39 348 918 8037')
   where k.id = 2 and k.contenuto like '%telefono +39 333 280 8226%'
  returning k.id
)
insert into change_log (tbl, row_id, op, before, after, chi, source)
select 'lead_knowledge', a.id::text, 'update', jsonb_build_object('telefono', '+39 333 280 8226'),
       jsonb_build_object('telefono', '+39 348 918 8037'), 'claude-code', 'migr 0197'
  from agg a;

-- 5) bozze non ancora inviate: firma nuova e "sono Giovanni" (il testo resta fuori da change_log)
with agg as (
  update lead_drafts d
     set testo = replace(replace(replace(d.testo,
                   E'Benedetta - Amimì Milano\nwholesale@amimi.it - +39 333 280 8226 - P.IVA 14559580965',
                   E'Giovanni - Amimì Milano\nwholesale@amimi.it - +39 348 918 8037 - P.IVA 14559580965'),
                   'sono Benedetta di Amim', 'sono Giovanni di Amim'), 'I''m Benedetta from Amim', 'I''m Giovanni from Amim'),
         updated_at = now()
   where d.stato = 'proposta'
     and (d.testo like E'%Benedetta - Amimì Milano\nwholesale@amimi.it - +39 333 280 8226%'
          or d.testo like '%sono Benedetta di Amim%' or d.testo like '%I''m Benedetta from Amim%')
  returning d.id
)
insert into change_log (tbl, row_id, op, before, after, chi, source)
select 'lead_drafts', a.id::text, 'firma_giovanni', null,
       jsonb_build_object('sostituzioni', 'firma, sono/I''m Benedetta -> Giovanni'), 'claude-code', 'migr 0197'
  from agg a;

-- 6) prova nella stessa transazione
do $$
declare
  v_def_chi text := (select pg_get_constraintdef(oid) from pg_constraint where conname = 'push_subscriptions_chi_ck');
  v_def_pred text := (select pg_get_constraintdef(oid) from pg_constraint where conname = 'push_temi_predefinito_per_ck');
begin
  if v_def_chi is distinct from 'CHECK ((chi = ANY (ARRAY[''Ale''::text, ''Bene''::text, ''Ginevra''::text, ''Giovanni''::text])))' then
    raise exception '0197: push_subscriptions_chi_ck inatteso: %', v_def_chi;
  end if;
  if v_def_pred is distinct from 'CHECK ((predefinito_per <@ ARRAY[''Ale''::text, ''Bene''::text, ''Ginevra''::text, ''Giovanni''::text]))' then
    raise exception '0197: push_temi_predefinito_per_ck inatteso: %', v_def_pred;
  end if;
  if (select count(*) from push_temi where 'Giovanni' = any(predefinito_per)) <> 2
     or (select count(*) from push_temi where key in ('negozi', 'riepilogo') and array_position(predefinito_per, 'Giovanni') is not null
           and cardinality(array_positions(predefinito_per, 'Giovanni')) = 1) <> 2 then
    raise exception '0197: Giovanni deve stare una volta sola nei soli temi negozi e riepilogo';
  end if;
  if (select value from app_flags where key = 'lead_firma') is distinct from E'Giovanni - Amimì Milano\nwholesale@amimi.it - +39 348 918 8037 - P.IVA 14559580965' then
    raise exception '0197: lead_firma non aggiornata';
  end if;
  if exists (select 1 from lead_sequences where corpo like '%Benedetta%' or chi_default is distinct from 'Giovanni') then
    raise exception '0197: un template nomina ancora Benedetta o non e'' di Giovanni';
  end if;
  if (select count(*) from lead_sequences where corpo like '%sono Giovanni di Amim%' or corpo like '%I''m Giovanni from Amim%') <> 3 then
    raise exception '0197: attesi 3 template che presentano Giovanni';
  end if;
  if exists (select 1 from lead_knowledge where contenuto like '%333 280 8226%') then
    raise exception '0197: il telefono vecchio resta in lead_knowledge';
  end if;
  if exists (select 1 from lead_drafts where stato = 'proposta'
               and (testo like '%333 280 8226%' or testo like '%sono Benedetta di Amim%' or testo like '%I''m Benedetta from Amim%')) then
    raise exception '0197: una bozza proposta ha ancora la firma vecchia o si presenta come Benedetta';
  end if;
  if current_setting('amimi.g0197_push_enabled_prima') is distinct from coalesce((select value from app_flags where key = 'push_enabled'), '<assente>')
     or current_setting('amimi.g0197_iscritti_prima') is distinct from (select count(*)::text from push_subscriptions) then
    raise exception '0197: push_enabled o le iscrizioni sono cambiati';
  end if;
end $$;

commit;
