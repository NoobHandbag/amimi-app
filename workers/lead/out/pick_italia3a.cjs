// Scelta manuale dallo sweep 3 blocchi 0-2 (indici di out/shortlist_italia3a.json, 28-09), round-robin per citta', grandi citta' in testa.
// Uso: node out/pick_italia3a.cjs <lista> <numero giro>
const fs = require('fs');
const L = JSON.parse(fs.readFileSync('out/shortlist_italia3a.json'));
const perCitta = {
  Roma: [48, 62, 99, 114, 119, 131, 132, 144, 153, 35],
  Napoli: [88, 127, 136, 198, 225, 236, 277, 312, 330, 372, 394, 411, 496],
  Torino: [78, 79, 94, 143, 182, 207, 257, 280, 332],
  Firenze: [45, 85, 97, 125, 172, 278],
  Genova: [186, 196, 285, 304, 425, 484],
  Cagliari: [135, 148, 237, 259, 274, 325, 367, 444, 502],
  Bologna: [179, 187, 202, 208, 365, 366, 486],
  Palermo: [123, 272, 335, 383, 402],
  Catania: [175, 247, 401, 476, 485],
  Bari: [105, 111, 232, 291, 300, 308, 479, 489],
  Prato: [18, 81, 199, 217, 266, 321, 448],
  Pistoia: [43, 124, 221, 327, 368],
  Viterbo: [95, 121, 129, 174, 255, 281],
  Latina: [115, 155, 286, 418],
  Terni: [120, 134, 181, 210, 385, 358],
};
const scelti = []; let more = true;
for (let r = 0; more; r++) { more = false; for (const c in perCitta) if (perCitta[c][r] != null) { scelti.push(perCitta[c][r]); more = true; } }
const n = Number(process.argv[2]);
const P = scelti.slice((n - 1) * 20, n * 20).map((i) => L[i]);
console.log(scelti.length, P.map((a) => `${a.nome} [${a.citta}]`).join(' | '));
fs.writeFileSync(`out/giro${process.argv[3]}_ids.txt`, P.map((a) => a.id).join(','));
