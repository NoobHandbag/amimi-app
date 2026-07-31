-- 0081: cs_messages.body_clean (brief 2026-07-31 redesign thread Assistenza, Parte A)
-- Corpo messaggio PULITO (citazioni/firme/boilerplate rimossi in modo deterministico da cs-sync
-- v10, funzione stripQuoted; per chat_notifica estrae il messaggio dal boilerplate Inbox).
-- body_text resta la fonte grezza INTATTA; body_clean NULL = pulizia non riuscita/vuota,
-- la UI fa fallback su body_text. Backfill una tantum: azione cs-sync `backfill_clean`.
alter table cs_messages add column if not exists body_clean text;
comment on column cs_messages.body_clean is 'Corpo pulito deterministico (cs-sync stripQuoted): solo le parole del mittente, senza citazioni/firma/boilerplate. NULL = fallback su body_text.';
