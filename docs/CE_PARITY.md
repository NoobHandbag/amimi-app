# CE_AMIMI — reverse-engineered definitions & parity status

> Aggiornato: 2026-07-04 (post-cutover). Read this file in two layers: the line DEFINITIONS below remain valid and are now implemented natively in the app (v_ce_totale, migration 0028, computed not copied); the PARITY STATUS sections are historical, pre-cutover (last full reconciliation: NIGHT_LOG SESSION 28). Since 2026-07-03 the app is the system of record for the CE and the Sheet no longer receives Qromo sales. Current state: amimi-app/docs/TRIGGER_MIGRAZIONE.md.

Derived empirically by comparing computed values to the Sheet's CE_AMIMI (read by the
`(Sottocategoria, Voce)` key in cols E/F, months in cols G–R). Validation: **Feb & Mar match
to the cent; Apr/May within ~1%** (residual = order-level refund timing, see §Residuals).

Parity oracle: `fixtures/ce_oracle.json` (extracted by `etl/ce_oracle.mjs`).
Harness: `etl/parity.mjs`. Months tested: Feb–May 2026 (closed months).

## Confirmed line definitions (CE_AMIMI = brand only)

| CE line | Formula (confirmed) |
|---|---|
| **Online Pezzi** | Σ shopify_line_items.quantita |
| **Online Vendite** | Σ line price × quantita |
| **Online (discount)** | − Σ shopify_orders.discount_total |
| **Online Free Shipping** | + Σ shopify_orders.free_shipping_amt (col84, stored **negative**) |
| **Online Spedizioni** | + Σ shopify_orders.shipping_total |
| **Online Fatturato Lordo** | Vendite − discount + FreeShipping + Spedizioni |
| **Online Fatturato Netto** | Online Lordo / 1.22 |
| **Offline Pezzi** | Σ qromo_sales.quantita |
| **Offline Fatturato Lordo** | Σ qromo_sales.prezzo  (**flat — prezzo is the row total, NOT ×qty**) |
| **Offline Fatturato Netto** | Offline Lordo / 1.22 |
| **B2B Pezzi/Lordo/Netto** | b2b_movements where tipo_movimento='venduto'; Lordo = Σ incasso_amimi; Netto=/1.22 (0 in Feb–May; B2B data starts Jun) |
| **Omnichannel Netto** | Online Netto + Offline Netto + B2B Netto |
| **Variabili COGS** | − (Σ shopify cogs_snapshot + Σ qromo cogs)  (**no gifts in CE_AMIMI**) |
| **Variabili Packaging** | − ( 3.71 × (online_pezzi + offline_pezzi) + 1 × online_ordini ) |
| **Variabili Commissioni** | Σ shopify_orders.payment_fees (already negative) |
| **Variabili Logistica** | Σ expenses where categoria=LOGISTICA, amimi, sottocategoria ~ 'sped*' |
| **Variabili Resi** | − Σ shopify_orders.refund_amount |
| **MC1** | Omnichannel Netto + (COGS + Packaging + Commissioni + Logistica + Resi) |
| **Fissi SALARI/TASSE/OPEX/EVENTI/MARKETING** | Σ expenses where categoria=cat AND amimi |
| **Fissi LOGISTICA (Magazzino)** | Σ expenses where categoria=LOGISTICA, amimi, sottocategoria NOT 'sped*' |
| **MC2** | MC1 + Σ all Fissi lines |

### Packaging components (confirmed unit × basis)
E-Commerce Box (1.00) scales **per online order**; the other five — Cartolina (0.5),
Adesivi (0.5), Carta Velina (0.1), Sacchetto (1.85), Nastro (0.76) = **3.71/unit** — scale
**per piece (online + offline)**. Feb: 3.71×23 + 1×17 = 102.33 ✓.

### The `amimi` filter (important correction)
The data stores **'Si'** (capital S) / 'No'. Google Sheets SUMIFS is **case-insensitive**, so
the CE matches 'Si'. The replica's `expenses.amimi` generated column was fixed to
`lower(trim(amimi_raw)) = 'si'` (migration 0004). This resolves the long-standing
"si vs Si" doc contradiction: **case-insensitive is correct.**

## Residuals (open — to close with order-level diffing)

> (SUPERATO il 2026-07-03: the Apr/May ~1% residuals are ACCEPTED by owner decision, no longer an open task.)
- **Refunded orders:** the CE excludes fully-`refunded` Shopify orders from **pieces/packaging**
  but appears to keep their **gross sale** in Vendite/Lordo (then subtracts via Resi). Modelling
  both consistently leaves Apr +67.5 / May −10 on Online Lordo (~0.7% / 0.1%). Needs order-level
  reconciliation (likely partial-refund Vendite adjustment + an order straddling a month edge).
- **Online Pezzi May:** computed 112 vs CE 110 — the 2 fully-refunded May orders.

## Corrected-overlay candidates (replica appears MORE correct than the Sheet)
- **4 inventory giacenze off by exactly −2** (db < sheet): `Maria_Bag_Red_Piercing`,
  `Lea_Bag_Zebra`, `Annie_Bag_Blue`, `Lea_Bag_Cocco_Beige`. The normalized (case-insensitive)
  codice join subtracts sales the Sheet's case-sensitive VLOOKUP missed. Flag for review; do NOT
  auto-adopt (DECISIONS D14).
  (SUPERATO il 2026-07-03: section closed post-cutover, the app is the system of record;
  Lea_Bag_Zebra was rectified with a physical count to 0.)

## CE_TOTALE — revenue validated; cost lines pending (migration 0007)

> (SUPERATO il 2026-07-03: v_ce_totale is NATIVE since migration 0028, computed not copied. Reconciled line by line: Jan/Feb/Mar exact, Apr/May ~1% ACCEPTED by owner decision. The "pending" status below is historical.)
`v_ce_totale` / `v_ce_totale_summary`. CE_TOTALE = CE_AMIMI channels + **gifts folded into
Offline** (pezzi + prezzo flat + cogs flat) + **all expenses** (no amimi filter).
- **Revenue validated:** `omni_netto` matches the Sheet (Mar exact 9,043.0; Apr/May within the
  same ~1% refund residual as CE_AMIMI). Confirms gifts→offline, gift COGS, gift packaging pieces.
- **Cost lines pending:** MC1/MC2 differ because CE_TOTALE handles **Variabili|Logistica**
  differently from CE_AMIMI (it is NOT the EXPENSES MASTER spedizioni split — e.g. Mar TOTALE var
  logistica = 0 vs AMIMI −425). Needs the same line-by-line reverse-engineering CE_AMIMI got.
- **Feb online 2× bug:** the Sheet's CE_TOTALE doubles Feb online (34 vs real 17). `v_ce_totale`
  does the correct thing (17) — a corrected-overlay item, so Feb intentionally won't match the Sheet.
Next finance task: reverse-engineer CE_TOTALE's variable-cost lines, then adopt/flag corrections.
(DONE, SUPERATO il 2026-07-03: completed with migration 0028, v_ce_totale native.)
