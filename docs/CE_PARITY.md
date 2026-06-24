# CE_AMIMI — reverse-engineered definitions & parity status

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

## CE_TOTALE (not yet reverse-engineered)
CE_TOTALE = CE_AMIMI channels + **gifts** (Offline += GIFT_OFFLINE pieces/prezzo) + **all**
expenses (no amimi filter). Its Feb online is anomalously 2× (a Sheet-side quirk) — corrected-
overlay candidate. Full CE_TOTALE parity is the next finance task.
