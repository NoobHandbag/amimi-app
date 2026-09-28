// Normalizza lo sweep per quartieri del 27-09: 'Roma Monti' -> citta 'Roma', il quartiere resta in fonte_seed/owner_note.
const fs = require('fs');
const rows = JSON.parse(fs.readFileSync('out/seed_maps_italia2.json'));
const BASE = ['Roma', 'Napoli', 'Torino', 'Firenze', 'Bologna', 'Palermo', 'Bari', 'Genova'];
for (const r of rows) {
  const b = BASE.find((x) => r.citta.startsWith(x + ' '));
  if (b) { r.citta = b; r.priorita_tipologia = 1; }
}
fs.writeFileSync('out/seed_maps_italia2_norm.json', JSON.stringify(rows, null, 1));
const c = {}; for (const r of rows) c[r.citta] = (c[r.citta] || 0) + 1;
console.log(rows.length, JSON.stringify(c));
