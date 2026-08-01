-- 0101 — schema RAMI: le tre bozze smettono di essere tre TONI della stessa risposta e diventano
-- gli ESITI possibili della richiesta, uno per alternativa, con un titolo di massimo 5 parole.
-- Brief: 2026-08-01_CLAUDE_CODE_BRIEF_cs_assist_migliorie.md, sezione "ESITO GIRO 2" (spec v17).
--
-- Perche'. Dove la verita' la sa solo il team (un restock arriva in tempo? si fa un'eccezione? si
-- manda un omaggio?), tre varianti di TONO della stessa risposta sbagliata non servono a niente:
-- il caso reale e' la conversazione 52796428, dove la cliente chiedeva un omaggio e tutte e tre le
-- bozze spiegavano la procedura di reso. Con i rami, la scelta della collega E' la risposta.
--
-- `cs_rami_enabled` nasce a **false**: il codice nuovo e' in produzione ma inerte, e il
-- comportamento resta identico a oggi finche' non gira il collaudo alla cieca chiesto dal punto 6
-- del brief (serve la chiave Gemini o un login @amimi.it, che questa sessione non ha).
-- Accensione e rollback = questo flag, senza deploy.
alter table public.cs_drafts add column if not exists rami        jsonb;
alter table public.cs_drafts add column if not exists ramo_scelto text;

comment on column public.cs_drafts.rami is
  'Titoli dei rami generati per questa bozza, nell''ordine proposto (jsonb array di stringhe). NULL quando la generazione e'' avvenuta col vecchio schema a toni o con il ripiego a bozza singola.';
comment on column public.cs_drafts.ramo_scelto is
  'Titolo del ramo che l''operatrice ha effettivamente usato, scritto al momento dell''invio (o della copia in Inbox per il canale chat), non alla generazione: e'' la scelta impegnativa, non un click di anteprima. Nel tempo e'' il dataset dei casi predefiniti reali (richiesta owner 01-08).';

insert into public.app_flags (key, value)
values ('cs_rami_enabled', 'false')
on conflict (key) do nothing;
