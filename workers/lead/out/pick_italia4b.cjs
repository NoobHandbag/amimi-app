// Seconda scelta dallo sweep 4 (28-09): residui 'multimarca' non presi da pick_italia4, triage per nome
// (esclusi centri commerciali, catene, streetwear, uomo, low cost, usato, bambini). Uso: node out/pick_italia4b.cjs <lista> <giro>
const fs = require('fs');
const L = JSON.parse(fs.readFileSync('out/shortlist_italia4.json'));
const scelti = [313, 76, 436, 201, 87, 118, 24, 66, 61, 71, 86, 505, 108, 312, 149, 410, 538, 276, 481, 400, 530, 27,
  572, 137, 205, 252, 473, 345, 420, 480, 506, 567, 536];
const n = Number(process.argv[2]);
const P = scelti.slice((n - 1) * 17, n * 17).map((i) => L[i]);
console.log(scelti.length, P.map((a) => `${a.nome} [${a.citta}]`).join(' | '));
fs.writeFileSync(`out/giro${process.argv[3]}_ids.txt`, P.map((a) => a.id).join(','));
