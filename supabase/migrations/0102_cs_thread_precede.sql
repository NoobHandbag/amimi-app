-- 0102 — cs_thread_precede: il thread puo' smentire il verdetto del caso (brief cs_thread_vs_verdetto, Parte 1)
--
-- Cancello della coda `pertinenzaBlock` che cs-assist v26 aggiunge a `casoBlock` quando la cliente ha
-- REPLICATO a una nostra risposta. Serve un flag suo, separato da `cs_rami_enabled`: dalla v26 il
-- blocco CASO e' `casoBlock` su entrambi gli schemi, quindi spegnere lo schema rami non toglierebbe
-- piu' la coda.
--
-- Nasce a `true`, e la deroga al default OFF della Regola Ferrea 19 e' dichiarata: questa non e' una
-- feature nuova da collaudare al buio, e' la correzione di un difetto gia' misurato (4 casi di reso
-- su 4 in cui la bozza contraddice un impegno che il team ha gia' preso per iscritto nel thread).
-- Nasce spenta significherebbe deployare un no-op e poi rimisurare una cosa che non e' mai arrivata
-- al modello, che e' esattamente la classe di fallimento silenzioso che vogliamo evitare.
--
-- Rollback della sola Parte 1, senza deploy:
--   update app_flags set value = 'false' where key = 'cs_thread_precede';
--
-- Additiva: nessuna tabella core toccata, nessuna riga di dati, nessuna vista.

insert into public.app_flags (key, value)
values ('cs_thread_precede', 'true')
on conflict (key) do nothing;
