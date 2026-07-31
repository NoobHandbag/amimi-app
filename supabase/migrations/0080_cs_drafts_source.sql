-- 0080 (2026-07-31, brief harness eval CS): cs_drafts.source distingue le bozze chieste da
-- un'operatrice in app ('app', default) da quelle generate dall'harness di valutazione
-- ('eval', scripts/cs-eval.mjs). Nessuna riga esistente cambia significato: erano tutte app.
alter table cs_drafts add column if not exists source text not null default 'app';
comment on column cs_drafts.source is 'app = bozza chiesta da operatrice; eval = generata dall''harness di valutazione (scripts/cs-eval.mjs, brief 29-07)';
