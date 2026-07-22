-- FLOW 6 v2 Fase 3: gate for AI-proposed WRITE actions, separate from ai_enabled (read features).
-- Default FALSE: the assistant can propose actions only after the owner explicitly enables them.
-- Even when on, the assistant only PROPOSES; execution goes through write-api on explicit user confirm.
alter table public.app_config add column if not exists ai_actions_enabled boolean not null default false;
