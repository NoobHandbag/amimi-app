-- 0200 (20-11, Giovanni): scegliere a quali indirizzi del negozio mandare un tocco, e i testi della sequenza italiana
-- sulla bozza che Giovanni ha scritto per Wait and See (lead_drafts del 20-11, origine manuale).
-- 1) v_lead_outreach porta anche emails_sito (tutte le email utili del sito, come v_lead_dossier dalla 0198): il
--    compositore della PWA le mostra come caselle da spuntare. Vista ricreata dalla 0198 (nessuna migrazione dopo l'ha
--    toccata); colonna nuova solo in coda.
-- 2) boutique_it tocchi 1, 2 e 4 nel tono di Giovanni: niente "piccolo" ne' "fatte a mano", line sheet "con modelli,
--    colori e condizioni commerciali", una domanda sola per l'appuntamento (showroom a Milano o il suo negozio).
--    Telefonata (0) e tocco 3 restano come sono. Before in change_log.

begin;

create or replace view v_lead_outreach with (security_invoker = on) as
 SELECT a.id, a.nome, a.tipo, a.citta, a.provincia, a.paese, a.website, a.ig_handle, a.email_generica, a.telefono,
    a.lead_stage, a.verdetto, a.verdetto_motivo, a.tier, a.gancio, a.prossima_azione, a.prossima_azione_at,
    a.owner_outreach, a.owner_note, s.totale, s.tier_proposto,
    t.at AS ultimo_tocco_at, t.canale AS ultimo_canale, t.direzione AS ultima_direzione, t.esito AS ultimo_esito, t.chi AS ultimo_chi,
    ( SELECT count(*) AS count FROM lead_touches x WHERE x.account_id = a.id) AS n_tocchi,
    ( SELECT count(*) AS count FROM lead_touches x
          WHERE x.account_id = a.id AND x.direzione = 'out'::text AND x.canale = 'email'::text) AS n_email_out,
        CASE WHEN t.at IS NULL THEN NULL::integer ELSE EXTRACT(day FROM now() - t.at)::integer END AS giorni_da_ultimo,
    a.prossima_azione_at IS NOT NULL AND a.prossima_azione_at < CURRENT_DATE AS scaduta,
    t.direzione = 'in'::text AND a.lead_stage = 'risposto'::text AS da_gestire,
    ( SELECT ((e.payload -> 'post'::text) -> 0) ->> 'asset_path'::text FROM lead_evidence e
          WHERE e.account_id = a.id AND e.tipo = 'ig_posts'::text AND (((e.payload -> 'post'::text) -> 0) ->> 'asset_path'::text) IS NOT NULL
          ORDER BY e.captured_at DESC LIMIT 1) AS thumb,
    (( SELECT e.payload ->> 'follower'::text FROM lead_evidence e
          WHERE e.account_id = a.id AND e.tipo = 'ig_metrics'::text ORDER BY e.captured_at DESC LIMIT 1))::integer AS follower,
    ( SELECT e.payload ->> 'telefono'::text FROM lead_evidence e
          WHERE e.account_id = a.id AND e.tipo = 'maps'::text ORDER BY e.captured_at DESC LIMIT 1) AS telefono_maps,
    em.l[1] AS email_sito,
    ( SELECT count(*) AS count FROM lead_contacts c WHERE c.account_id = a.id AND c.opt_out) AS n_opt_out,
    ( SELECT d.sequenza_tocco FROM lead_drafts d
          WHERE d.account_id = a.id AND d.origine = 'auto'::text AND d.stato = 'proposta'::text AND a.lead_stage = 'contattato'::text
            AND NOT (EXISTS ( SELECT 1 FROM lead_touches x
                  WHERE x.account_id = a.id AND x.direzione = 'out'::text AND x.canale = 'email'::text AND x.sequenza_tocco = d.sequenza_tocco))
          ORDER BY d.created_at DESC LIMIT 1) AS bozza_auto_tocco,
    COALESCE(em.l, '{}'::text[]) AS emails_sito
   FROM lead_accounts a
     LEFT JOIN LATERAL ( SELECT public.lead_emails_sito(e.payload) AS l FROM lead_evidence e
          WHERE e.account_id = a.id AND e.tipo = 'site_meta'::text ORDER BY e.captured_at DESC LIMIT 1) em ON true
     LEFT JOIN LATERAL ( SELECT x.id, x.account_id, x.run_id, x.rubrica_version, x.criteri, x.bonus, x.esclusione, x.totale,
            x.tier_proposto, x.dati_incompleti, x.motivazione, x.perche_no, x.modello, x.created_at
           FROM lead_scores x WHERE x.account_id = a.id ORDER BY x.created_at DESC LIMIT 1) s ON true
     LEFT JOIN LATERAL ( SELECT y.id, y.account_id, y.contact_id, y.canale, y.direzione, y.gmail_message_id, y.gmail_thread_id,
            y.subject, y.body_clean, y.stage_prima, y.stage_dopo, y.chi, y.at, y.created_at, y.esito, y.prossima_azione,
            y.prossima_azione_at, y.sequenza_tocco
           FROM lead_touches y WHERE y.account_id = a.id ORDER BY y.at DESC LIMIT 1) t ON true
  WHERE a.verdetto = 'da_contattare'::text OR a.lead_stage <> 'da_contattare'::text OR a.owner_outreach IS NOT NULL;

create temp table nuovi_testi (tocco int primary key, oggetto text, corpo text) on commit drop;
insert into nuovi_testi values
(1, 'Amimì Milano per {{nome_negozio}}: borse artigianali e line sheet wholesale',
E'Gentile {{referente}},\n\nsono Giovanni di Amimì Milano, brand di borse artigianali con prezzi al pubblico da 50 a 190 euro. La nostra pelle è Made in Italy, mentre le linee più leggere sono in cotone naturale colorato.\n\n{{gancio}}\n\nQui trova la nostra line sheet con modelli, colori e condizioni commerciali: {{linesheet}}\n\nPossiamo fissare un appuntamento nel nostro showroom a Milano o nel suo negozio per farle vedere qualche pezzo dal vivo?\n\nUn caro saluto,\n{{firma}}\nSe preferisce non ricevere altre email da parte mia, mi risponda "no grazie" e non la contatterò più.'),
(2, 'Re: Amimì Milano per {{nome_negozio}}',
E'Gentile {{referente}},\n\nle riscrivo per sapere se ha ricevuto la mia email con la line sheet. Le segnalo i tre pezzi che stanno funzionando meglio in questa stagione: la Lea in pelle cocco, la Nina in cotone colorato e gli accessori piccoli (cover e case), che al banco cassa girano bene.\n\nPossiamo fissare un appuntamento nel nostro showroom a Milano o nel suo negozio per farle vedere qualche pezzo dal vivo?\n\nUn caro saluto,\n{{firma}}'),
(4, 'Resto a disposizione',
E'Gentile {{referente}},\n\nnon voglio disturbarla oltre. Le lascio la nostra line sheet con modelli, colori e condizioni commerciali: {{linesheet}}\n\nSe in futuro vorrà inserire le nostre borse, mi trova sempre qui. Le auguro buon lavoro.\n\nUn caro saluto,\n{{firma}}\nNon la contatterò ulteriormente salvo un suo cenno.');

insert into change_log (tbl, row_id, op, before, after, chi, source)
select 'lead_sequences', s.id::text, 'update', jsonb_build_object('oggetto', s.oggetto, 'corpo', s.corpo),
       jsonb_build_object('oggetto', n.oggetto, 'corpo', n.corpo), 'claude-code', 'migr 0200'
  from lead_sequences s join nuovi_testi n on n.tocco = s.tocco
 where s.codice = 'boutique_it';

update lead_sequences s set oggetto = n.oggetto, corpo = n.corpo
  from nuovi_testi n
 where s.codice = 'boutique_it' and s.tocco = n.tocco;

do $$
begin
  if (select count(*) from lead_sequences s join nuovi_testi n on n.tocco = s.tocco
       where s.codice = 'boutique_it' and s.corpo = n.corpo and s.oggetto = n.oggetto) <> 3 then
    raise exception '0200: testi boutique_it non aggiornati (attesi 3)';
  end if;
end $$;

commit;
