# Changelog codice

Una riga per run. La più recente in alto. Il dettaglio sta nella scheda in
`docs/` linkata a fine riga.

- 2026-08-31 · **Design System Amimì v2** applicato a tutta l'app: palette brand
  (rose `#8B5E6B`, aubergine `#2D2226`, caramel `#C4956A`) al posto della palette
  GEEIQ, fondo foto prodotto `#E8E4DE`, Fraunces self-hosted sui soli heading con
  le cifre tenute in Roboto per costruzione, `--hairline`/`--edge` separati per
  WCAG 1.4.11, gradienti e ombre colorate ritirati, emoji sostituite da icone a
  linea, focus ring e tap target 44px ovunque. Contratto in `DESIGN.md` (root),
  dettaglio in [`docs/DESIGN_SYSTEM_v2.md`](DESIGN_SYSTEM_v2.md), verifica con
  `bash web/scripts/check-design-system.sh`. Solo frontend: nessuna modifica a
  dati, viste, edge function o logica.
