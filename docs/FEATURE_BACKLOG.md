# Amimì App — feature backlog (from old-chats analysis)

Source: `Catalogo_Chat_Amimi.xlsx` (363 catalogued Claude/Cowork chats) + `Analisi_Razionalizzazione.md`,
mined 2026-06-25. Ranked by frequency-in-chats × value. "Built" = shipped; "Designed" = spec ready.

His own analysis flags the two most-manual / most-sales-eroding areas: **returns** (invisible in the CE
today) and the **reorder + SKU-availability** pair. Those lead the list.

> **STATUS (2026-06-25):** BUILT & LIVE — #1 Returns, #2 Reorder, #3 SKU-availability, #4 Deal
> calculator, #5 Pricing helper, #6 SEO generator, #9 Ads card, #10 Valuation. NOT BUILT (need an
> external data feed we don't hold in the replica): #7 Customer-service triage (DM/email export) and
> #8 In-store/popup analytics (Shopify order tags aren't in our read-only order pull). Give me the
> feed and I'll build those two too.

## 1. Returns & Exchanges — "Registra Reso / Cambio"  [BUILT]
One-tap logging of a return or swap across all 3 channels, capturing the two distinct effects:
money (CE "Resi" row) and stock (does the bag become sellable again, and where).
- Section: Inserisci (sibling of count/purchase/gift). Data: new `returns` table
  (data, codice, qty, canale online|qromo|b2b, importo_rimborsato, rientra_stock bool, motivo, note).
- Variants: full vs partial refund; refund-without-restock (damaged); exchange = return + new sale;
  B2B `reso` re-pools stock, never hits CE money. Evidence: chats #43/#163, `PROMPT_Resi_Analisi.md`
  ("offline returns are invisible in the CE today; wants a button like Registra conta/arrivi").

## 2. Reorder / "Cosa Riprodurre" board  [DESIGNED]
Live list of what to reorder/produce: per-SKU velocity (last 60d) + current stock + incoming, flagging
best-sellers that are out of stock. Section: new "Riordino" view (or Inventario subtab). Data: sales
(Shopify+Qromo 60d) + giacenza + in-arrivo (supplier_orders open). Evidence: #226/#179/#48/#336.

## 3. SKU-availability monitor  [DESIGNED]
Daily count + trend of variants ACTIVE on Shopify AND stock>0, split by line; two loss types
(in-stock-not-published vs published-sold-out); alert under a target. Distinct from the THIRD-flow
misalignment fixer (that's reconciliation; this is trend/target). Data: daily shopify_stock snapshot +
giacenza. Evidence: #71/#117/#153, `PROMPT_tracking_disponibilita_SKU.md`.

## 4. Conto-vendita / Wholesale deal calculator  [DESIGNED]
Given a shop deal, compute margin per bag and per mix: COGS vs sell-in, VAT absorbed, profit; compare
wholesale vs conto-vendita. Section: new B2B calculator. Evidence: #89/#329/#2, TADAAN/Como/Levanto docs.

## 5. Pricing helper (COGS → price/markup)  [DESIGNED — cheap]
On new product, suggest price from COGS + target margin, VAT-inclusive; flag inconsistent variants.
Extends the new-product flow. Evidence: #249/#263/#329.

## 6. SEO title generator  [DESIGNED — cheap]
Auto-build the Italian SEO title to brand formula (leather vs Nina/textile; 60–70 chars; Made in Italy
except Nina) at publish. Extends publish hub. Evidence: #202; formula already in CLAUDE.md.

## 7. Customer-service inbox triage  [DESIGNED — L]
Classify incoming DM/email (sizing, shipping, returns, availability), surface top questions, draft canned
answers from an FAQ. New "Servizio Clienti" tab. Evidence: #0/#67/#114, IG_DM_classificati, FAQ csv.

## 8. In-store / popup pickup analytics  [DESIGNED]
Track ritiri-in-negozio + popup sales as a channel (count, MoM, geo). Dashboard card. Evidence: #23/#257.

## 9. Meta Ads weekly card  [DESIGNED]
Recurring light ad cadence (spend, ROAS, top creatives). New "Ads" tab; Meta MCP already connected.
Evidence: #128/#218/#246/#91; analysis: Ads/Finance under-invested.

## 10. Inventory valuation report  [DESIGNED — cheap]
On-demand stock value at COGS and at retail, by line. Finance/dashboard report. Evidence: #297.

(Lower / situational, noted not expanded: back-in-stock notify mgmt, corporate gifting, wedding portals,
TikTok Shop — exploratory, not recurring ops.)

## Known edge cases (testing fodder, from the chats)
- CODICE casing/spacing mismatches (Maria_Bag_Red_ vs _Red vs _RED; "Choccolate" vs "CHOCOLATE") — the
  #1 silent-failure source. Normalize + resolve PCP-then-PRODUCT_MAP.
- Regular vs MAXI are distinct purchasable SKUs (inverted ITEM cols once).
- Negative stock from a never-registered purchase (Vernice_Rossa, Blue_Electric, Bordeaux, Zebra).
- Returns: partial stays "Paid"/sold; only `refunded` re-enters stock.
- Qromo writes the PAID amount, not catalog price.
- Three stock locations: gestionale (truth) / Shopify (site, −2 buffer) / Qromo (store).
  (SUPERATO il 2026-07-03: Shopify policy is now mirror-of-real, buffer 0, hold opt-in via shopify_hold_raises.)
- B2B `reso` = stock returning, never a CE money refund.
- Gift units must use the canonical codice or they aren't subtracted.
