-- 0078: chat Shopify Inbox — se il visitatore ha lasciato l'email in chat, Shopify la usa come
-- "nome" nella notifica e cs-sync (fino alla v4) la salvava solo in customer_name. Backfill:
-- customer_email = customer_name dove il nome e' un indirizzo email. Da cs-sync v5 avviene all'ingest.
update cs_conversations
   set customer_email = lower(customer_name)
 where canale = 'chat_notifica'
   and customer_email is null
   and customer_name ~* '^[^[:space:]@]+@[^[:space:]@]+\.[A-Za-z]{2,}$';
