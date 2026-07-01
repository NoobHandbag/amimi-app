-- 0029 — shopify-stock realign must update ALL variants of a codice.
-- Dual-variant bags (Agata SC/CC "Senza Catena"/"Con Catena") are two Shopify variants that
-- share one physical stock and resolve to one CODICE via the product-title alias. Keep every
-- variant's inventory_item so the realign pushes the same quantity to both (like variant-sync).
ALTER TABLE shopify_stock ADD COLUMN IF NOT EXISTS inventory_item_ids text[];
