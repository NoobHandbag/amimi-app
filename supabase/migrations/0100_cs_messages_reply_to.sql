-- 0100 — `cs_messages.reply_to`: fonte dell'email cliente INDIPENDENTE dal corpo del messaggio.
-- Brief: 2026-08-01_CLAUDE_CODE_BRIEF_cs_reply_to_fonte_indipendente.md
--
-- Perche'. Sul canale modulo il mittente e' il wrapper (`mailer@shopify.com`), quindi l'unica fonte
-- PER MESSAGGIO di "chi e' la cliente che ha scritto questa riga" e' `form_fields.email`, che
-- `cs-sync` estrae solo se riconosce lo stampo del modulo dentro il CORPO (marcatori IT/EN).
-- Quello stesso riconoscimento decide anche se separare due invii in due conversazioni: i due
-- lavori dipendono dalla stessa cosa e, se la frase cambia (una terza lingua, o Shopify che
-- ritocca il template: e' gia' successo il 01-08), falliscono INSIEME e in silenzio. La cintura
-- cross-cliente di `cs-send` resterebbe senza l'email con cui accorgersene.
-- L'header `Reply-To` porta la stessa informazione a prescindere dalla lingua del corpo: `cs-sync`
-- oggi lo legge (serve a `classify` per distinguere un modulo da una notifica amministrativa) ma
-- non lo conserva. Questa colonna lo conserva.
--
-- Additiva, modulo `cs_*`, nessuna tabella core toccata (Regola Ferrea 19).
alter table public.cs_messages add column if not exists reply_to text;

comment on column public.cs_messages.reply_to is
  'Header Reply-To del messaggio Gmail, minuscolo, come arrivato (NULL se assente). Fonte dell''email cliente indipendente dal corpo: sul canale modulo Shopify lo valorizza con l''indirizzo di chi ha compilato, qualunque sia la lingua del template. Usato come ULTIMA risorsa da emailCliente() in cs-send e cs-assist, dopo form_fields.email e from_email, cosi'' non puo'' cambiare un esito gia'' corretto. Popolata all''ingest da cs-sync dal 2026-08-01; lo storico si riempie con l''azione backfill_replyto.';
