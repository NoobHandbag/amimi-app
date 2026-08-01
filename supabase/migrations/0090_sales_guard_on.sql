-- NEL DB: applicata come `0089_sales_guard_on` (01-08 mattina). File locale rinumerato 0090 per
-- la collisione di numerazione col 0089 margine della sessione parallela (stessa classe del caso
-- 0078/0079: fa fede il timestamp DB, il numero nel nome e' solo ordinamento locale).
-- 0090: go-live sales-guard (decisione owner in chat, 2026-08-01 mattina: "attiviamola").
-- Il cron sales-guard-daily (05:45 UTC) da domani gira per davvero; push ntfy solo su S1
-- zero-ordini al cambio di stato, topic = ntfy_topic esistente (nessun topic dedicato richiesto).
update app_flags set value = 'true' where key = 'sales_guard_enabled';
