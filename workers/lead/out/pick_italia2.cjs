// Scelta manuale dallo sweep per quartieri e medie citta' del 27-09 (indici di out/shortlist_italia2.json), round-robin per citta'
// con le grandi citta' in testa. Esclusi per nome: catene, pelletterie, gioielli, souvenir, uomo, sposa, design d'arredo.
// Uso: node out/pick_italia2.cjs <lista 1..7> <numero giro>
const fs = require('fs');
const L = JSON.parse(fs.readFileSync('out/shortlist_italia2.json'));
const perCitta = {
  Roma: [101, 110, 117, 125, 126, 160, 219, 254, 261, 262, 267, 272, 336],
  Torino: [35, 141, 180, 213, 256, 322, 348, 386, 527, 548],
  Napoli: [188, 222, 237, 263, 396, 428, 480, 567, 506],
  Firenze: [145, 150, 195, 196, 278, 313, 358, 397, 398, 570],
  Palermo: [238, 246, 323, 412, 532, 202],
  Bologna: [175, 531, 588, 573], Genova: [130, 231, 268], Bari: [259, 473, 339],
  Siracusa: [27, 288, 308, 344, 352], Bolzano: [29, 115, 232, 284], Udine: [120, 146, 283, 293, 341],
  Vicenza: [15, 44, 416, 459], Treviso: [111, 240, 248, 279], Ferrara: [69, 86, 176, 403],
  Pesaro: [142, 151, 287], Macerata: [74, 168, 300], Caserta: [66, 441, 450], Arezzo: [41, 239, 387],
  Siena: [165, 266, 228], Ravenna: [230, 343, 374], Taranto: [183, 235], Sassari: [501, 494, 271],
  Messina: [90, 319, 320], 'La Spezia': [98, 337, 362], Livorno: [655, 470], Novara: [419, 466],
};
const scelti = []; let more = true;
for (let r = 0; more; r++) { more = false; for (const c in perCitta) if (perCitta[c][r] != null) { scelti.push(perCitta[c][r]); more = true; } }
const n = Number(process.argv[2]);
const P = scelti.slice((n - 1) * 20, n * 20).map((i) => L[i]);
console.log(scelti.length, P.map((a) => `${a.nome} [${a.citta}]`).join(' | '));
fs.writeFileSync(`out/giro${process.argv[3]}_ids.txt`, P.map((a) => a.id).join(','));
