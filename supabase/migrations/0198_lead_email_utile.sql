-- 0198 (19-11, Giovanni): una PEC non e' un'email per l'outreach B2B. Fino a qui "l'email del sito" era la prima
-- trovata dal collector (site_meta.emails[0]), e su 5 negozi era una PEC (pec.it, legalmail.it, ...): il cartellino
-- della Pipeline diceva "email 1 a ...@pec.it" invece di "nessuna email: cercarla". Nelle stesse liste ci sono anche
-- indirizzi che non sono del negozio: segnaposto dei template (nome@gmail.com, utente@dominio.com, xxx@xxx.xxx), il
-- Garante privacy (pec.gpdp.it), web agency e portali che compaiono su piu' siti.
-- La regola vive QUI e basta: lead_email_utile() dice se un indirizzo vale come email del negozio, lead_emails_sito()
-- filtra la lista del sito. Le viste la leggono (email_sito = la prima utile; v_lead_dossier anche emails_sito = tutte
-- le utili), e la leggono cosi' la PWA (cartellino, scheda, filtro "Senza email" di Negozi) e la edge lead-outreach
-- (destinatario della bozza automatica, v16). lead_evidence resta com'e': nessun dato riscritto.
-- Viste ricreate dalla definizione viva (pg_get_viewdef del 19-11); colonne nuove solo in coda.
-- Prova: tests/lead_email_utile.sql (in produzione, finisce in TEST_OK senza lasciare niente).

begin;

create or replace function public.lead_email_utile(e text) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(
    x ~ '^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$'
    -- PEC: un'etichetta intera del dominio, mai "pec" dentro un nome qualunque (spec.it, ipec.it, pecora.it restano):
    -- pec.<provider>, i gestori con "pec" attaccato (arubapec.it, confcommerciopec.it, ...), legalmail, postacert, certificata
    and split_part(x, '@', 2) !~ '(^|\.)(pec|arubapec|confcommerciopec|registerpec|gigapec|mypec|cnapec|pecimprese|legalmail|postacert|postecert|pcert|certificata|cert|actaliscertymail|sicurezzapostale|postacertificata)\.'
    -- domini che non sono del negozio: segnaposto, Garante privacy, web agency e portali visti su piu' siti; i segnaposto
    -- sono quelli di emailCommerciale() del collector (workers/lead/priority.mjs), da tenere allineati
    and split_part(x, '@', 2) !~ '(^|\.)(domain\.com|dominio\.(com|it)|esempio\.(com|it)|email\.(com|it|address)|example\.(com|it|org|net)|xxx\.xxx|yourdomain\.com|mailservice\.[a-z]+|sentry\.io|wixpress\.com|gpdp\.it|webador\.it|ilportaledellaliguria\.it|mlinformaticasrl\.it)$'
    -- segnaposto dei template ("nome@gmail.com", "tuo@..."), il responsabile privacy, il ">" scappato dal JSON (u003e)
    and split_part(x, '@', 1) !~ '^(nome|utente|user|tuo|tua|tua-email|iltuo|your|yourname|name|johndoe|john\.doe|mymail|xxx|esempio|mario\.rossi|dpo)$|^u003e',
  false)
  from (select lower(btrim(e)) as x) s
$$;

create or replace function public.lead_emails_sito(p jsonb) returns text[]
language sql immutable set search_path = '' as $$
  select coalesce(array_agg(z.x order by z.o), '{}')
  from (
    select distinct on (lower(btrim(t.v))) btrim(t.v) as x, t.o
    from jsonb_array_elements_text(case when jsonb_typeof(p -> 'emails') = 'array' then p -> 'emails' else '[]'::jsonb end) with ordinality t(v, o)
    where public.lead_email_utile(t.v)
    order by lower(btrim(t.v)), t.o
  ) z
$$;

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
    ( SELECT (public.lead_emails_sito(e.payload))[1] FROM lead_evidence e
          WHERE e.account_id = a.id AND e.tipo = 'site_meta'::text ORDER BY e.captured_at DESC LIMIT 1) AS email_sito,
    ( SELECT count(*) AS count FROM lead_contacts c WHERE c.account_id = a.id AND c.opt_out) AS n_opt_out,
    ( SELECT d.sequenza_tocco FROM lead_drafts d
          WHERE d.account_id = a.id AND d.origine = 'auto'::text AND d.stato = 'proposta'::text AND a.lead_stage = 'contattato'::text
            AND NOT (EXISTS ( SELECT 1 FROM lead_touches x
                  WHERE x.account_id = a.id AND x.direzione = 'out'::text AND x.canale = 'email'::text AND x.sequenza_tocco = d.sequenza_tocco))
          ORDER BY d.created_at DESC LIMIT 1) AS bozza_auto_tocco
   FROM lead_accounts a
     LEFT JOIN LATERAL ( SELECT x.id, x.account_id, x.run_id, x.rubrica_version, x.criteri, x.bonus, x.esclusione, x.totale,
            x.tier_proposto, x.dati_incompleti, x.motivazione, x.perche_no, x.modello, x.created_at
           FROM lead_scores x WHERE x.account_id = a.id ORDER BY x.created_at DESC LIMIT 1) s ON true
     LEFT JOIN LATERAL ( SELECT y.id, y.account_id, y.contact_id, y.canale, y.direzione, y.gmail_message_id, y.gmail_thread_id,
            y.subject, y.body_clean, y.stage_prima, y.stage_dopo, y.chi, y.at, y.created_at, y.esito, y.prossima_azione,
            y.prossima_azione_at, y.sequenza_tocco
           FROM lead_touches y WHERE y.account_id = a.id ORDER BY y.at DESC LIMIT 1) t ON true
  WHERE a.verdetto = 'da_contattare'::text OR a.lead_stage <> 'da_contattare'::text OR a.owner_outreach IS NOT NULL;

create or replace view v_lead_lista with (security_invoker = on) as
 SELECT a.id, a.nome, a.tipo, a.citta, a.paese, a.website, a.ig_handle, a.telefono, a.email_generica, a.stato_ricerca,
    a.lead_stage, a.tier, a.gancio, a.owner_note, a.verdetto, a.verdetto_motivo, s.totale, s.tier_proposto, s.esclusione,
    "left"(s.motivazione, 200) AS motivazione,
    ( SELECT jsonb_build_object('follower', e.payload -> 'follower'::text) AS jsonb_build_object FROM lead_evidence e
          WHERE e.account_id = a.id AND e.tipo = 'ig_metrics'::text ORDER BY e.captured_at DESC LIMIT 1) AS ig_metrics,
    ( SELECT jsonb_build_object('rating', e.payload -> 'rating'::text, 'recensioni', e.payload -> 'recensioni'::text, 'telefono', e.payload -> 'telefono'::text) AS jsonb_build_object
           FROM lead_evidence e WHERE e.account_id = a.id AND e.tipo = 'maps'::text ORDER BY e.captured_at DESC LIMIT 1) AS maps,
    ( SELECT jsonb_build_object('peer_match', e.payload -> 'peer_match'::text, 'vendors', e.payload -> 'vendors'::text) AS jsonb_build_object
           FROM lead_evidence e WHERE e.account_id = a.id AND e.tipo = 'brands_carried'::text ORDER BY e.captured_at DESC LIMIT 1) AS brands_carried,
    ( SELECT jsonb_build_object('borse', e.payload -> 'borse'::text) AS jsonb_build_object FROM lead_evidence e
          WHERE e.account_id = a.id AND e.tipo = 'price_band'::text ORDER BY e.captured_at DESC LIMIT 1) AS price_band,
    COALESCE(( SELECT ((e.payload -> 'post'::text) -> 0) ->> 'asset_path'::text FROM lead_evidence e
          WHERE e.account_id = a.id AND e.tipo = 'ig_posts'::text AND (((e.payload -> 'post'::text) -> 0) ->> 'asset_path'::text) IS NOT NULL
          ORDER BY e.captured_at DESC LIMIT 1), ( SELECT e.asset_path FROM lead_evidence e
          WHERE e.account_id = a.id AND e.tipo = 'screenshot_ig'::text ORDER BY e.captured_at DESC LIMIT 1), ( SELECT e.asset_path FROM lead_evidence e
          WHERE e.account_id = a.id AND e.tipo = 'screenshot_home_mobile'::text ORDER BY e.captured_at DESC LIMIT 1), ( SELECT e.asset_path FROM lead_evidence e
          WHERE e.account_id = a.id AND e.tipo = 'screenshot_home'::text ORDER BY e.captured_at DESC LIMIT 1)) AS img,
    ( SELECT count(*) AS count FROM lead_evidence e WHERE e.account_id = a.id) AS n_evidenze,
    ( SELECT (public.lead_emails_sito(e.payload))[1] FROM lead_evidence e
          WHERE e.account_id = a.id AND e.tipo = 'site_meta'::text ORDER BY e.captured_at DESC LIMIT 1) AS email_sito
   FROM lead_accounts a
     LEFT JOIN LATERAL ( SELECT x.totale, x.tier_proposto, x.esclusione, x.motivazione FROM lead_scores x
          WHERE x.account_id = a.id ORDER BY x.created_at DESC LIMIT 1) s ON true;

create or replace view v_lead_dossier with (security_invoker = on) as
 SELECT a.id, a.nome, a.tipo, a.gruppo_id, a.indirizzo, a.citta, a.provincia, a.regione, a.paese, a.lat, a.lng, a.website,
    a.ig_handle, a.google_place_id, a.google_maps_url, a.telefono, a.email_generica, a.piva, a.fonte_seed, a.priorita_tipologia,
    a.stato_ricerca, a.rejected_motivo, a.lead_stage, a.tier, a.gancio, a.gancio_evidence_id, a.owner_note, a.contattato_prima,
    a.chi, a.negozio_id, a.created_at, a.updated_at, a.verdetto, a.verdetto_motivo, a.verdetto_chi, a.verdetto_at,
    s.id AS score_id, s.totale, s.tier_proposto, s.criteri, s.bonus, s.esclusione, s.dati_incompleti, s.motivazione,
    s.perche_no, s.rubrica_version, s.created_at AS scored_at,
    r.azione AS ultima_review_azione, r.chi AS ultima_review_chi, r.created_at AS ultima_review_at,
    ( SELECT e.asset_path FROM lead_evidence e WHERE e.account_id = a.id AND e.tipo = 'screenshot_home'::text ORDER BY e.captured_at DESC LIMIT 1) AS shot_home,
    ( SELECT e.asset_path FROM lead_evidence e WHERE e.account_id = a.id AND e.tipo = 'screenshot_home_mobile'::text ORDER BY e.captured_at DESC LIMIT 1) AS shot_home_mobile,
    ( SELECT e.asset_path FROM lead_evidence e WHERE e.account_id = a.id AND e.tipo = 'screenshot_ig'::text ORDER BY e.captured_at DESC LIMIT 1) AS shot_ig,
    ( SELECT e.asset_path FROM lead_evidence e WHERE e.account_id = a.id AND e.tipo = 'screenshot_maps'::text ORDER BY e.captured_at DESC LIMIT 1) AS shot_maps,
    ( SELECT e.asset_path FROM lead_evidence e WHERE e.account_id = a.id AND e.tipo = 'screenshot_maps_photos'::text ORDER BY e.captured_at DESC LIMIT 1) AS shot_maps_photos,
    ( SELECT e.payload FROM lead_evidence e WHERE e.account_id = a.id AND e.tipo = 'ig_metrics'::text ORDER BY e.captured_at DESC LIMIT 1) AS ig_metrics,
    ( SELECT e.payload FROM lead_evidence e WHERE e.account_id = a.id AND e.tipo = 'ig_posts'::text ORDER BY e.captured_at DESC LIMIT 1) AS ig_posts,
    ( SELECT e.payload FROM lead_evidence e WHERE e.account_id = a.id AND e.tipo = 'maps'::text ORDER BY e.captured_at DESC LIMIT 1) AS maps,
    ( SELECT e.payload FROM lead_evidence e WHERE e.account_id = a.id AND e.tipo = 'maps_reviews'::text ORDER BY e.captured_at DESC LIMIT 1) AS maps_reviews,
    ( SELECT e.payload FROM lead_evidence e WHERE e.account_id = a.id AND e.tipo = 'brands_carried'::text ORDER BY e.captured_at DESC LIMIT 1) AS brands_carried,
    ( SELECT e.payload FROM lead_evidence e WHERE e.account_id = a.id AND e.tipo = 'price_band'::text ORDER BY e.captured_at DESC LIMIT 1) AS price_band,
    ( SELECT e.payload FROM lead_evidence e WHERE e.account_id = a.id AND e.tipo = 'site_products'::text ORDER BY e.captured_at DESC LIMIT 1) AS site_products,
    ( SELECT e.payload FROM lead_evidence e WHERE e.account_id = a.id AND e.tipo = 'stampa'::text ORDER BY e.captured_at DESC LIMIT 1) AS stampa,
    ( SELECT e.payload FROM lead_evidence e WHERE e.account_id = a.id AND e.tipo = 'site_meta'::text ORDER BY e.captured_at DESC LIMIT 1) AS site_meta,
    ( SELECT e.payload FROM lead_evidence e WHERE e.account_id = a.id AND e.tipo = 'about_text'::text ORDER BY e.captured_at DESC LIMIT 1) AS about_text,
    ( SELECT ((e.payload -> 'post'::text) -> 0) ->> 'asset_path'::text FROM lead_evidence e
          WHERE e.account_id = a.id AND e.tipo = 'ig_posts'::text AND (((e.payload -> 'post'::text) -> 0) ->> 'asset_path'::text) IS NOT NULL
          ORDER BY e.captured_at DESC LIMIT 1) AS thumb,
    ( SELECT count(*) AS count FROM lead_evidence e WHERE e.account_id = a.id) AS n_evidenze,
    ( SELECT count(*) AS count FROM lead_contacts c WHERE c.account_id = a.id) AS n_contatti,
    g.nome AS gruppo_nome,
    em.l[1] AS email_sito,
    COALESCE(em.l, '{}'::text[]) AS emails_sito
   FROM lead_accounts a
     LEFT JOIN LATERAL ( SELECT public.lead_emails_sito(e.payload) AS l FROM lead_evidence e
          WHERE e.account_id = a.id AND e.tipo = 'site_meta'::text ORDER BY e.captured_at DESC LIMIT 1) em ON true
     LEFT JOIN LATERAL ( SELECT x.id, x.account_id, x.run_id, x.rubrica_version, x.criteri, x.bonus, x.esclusione, x.totale,
            x.tier_proposto, x.dati_incompleti, x.motivazione, x.perche_no, x.modello, x.created_at
           FROM lead_scores x WHERE x.account_id = a.id ORDER BY x.created_at DESC LIMIT 1) s ON true
     LEFT JOIN LATERAL ( SELECT y.id, y.account_id, y.chi, y.azione, y.tier, y.motivo, y.nota, y.created_at, y.verdetto
           FROM lead_reviews y WHERE y.account_id = a.id ORDER BY y.created_at DESC LIMIT 1) r ON true
     LEFT JOIN lead_accounts g ON g.id = a.gruppo_id;
commit;
