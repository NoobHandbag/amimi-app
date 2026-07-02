-- 0031: note storiche sugli acquisti (dal Master ACQUISTI col Note + Riferimento_Documento).
-- Backfill one-off eseguito il 2026-07-03 (39 righe: difetti, ricodifiche, rettifiche conta).
alter table purchases add column if not exists note text;
