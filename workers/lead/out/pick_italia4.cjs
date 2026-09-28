// Scelta manuale dallo sweep 4 'boutique multimarca' (indici di out/shortlist_italia4.json, 28-09), round-robin, grandi citta' in testa.
// Uso: node out/pick_italia4.cjs <lista> <numero giro>
const fs = require('fs');
const L = JSON.parse(fs.readFileSync('out/shortlist_italia4.json'));
const perCitta = {
  Roma: [92, 98, 131, 147, 169, 176, 376, 494], Napoli: [65, 175, 459, 243, 228, 365, 437], Torino: [43, 182, 222],
  Firenze: [46, 56, 72, 73, 242, 458], Bologna: [81, 106, 133, 254, 519], Genova: [64, 181, 236, 408, 520],
  Palermo: [178, 229, 244, 476, 537], Bari: [30, 116, 352, 390, 411, 442, 460, 564], Catania: [121, 128, 134, 141, 441],
  Venezia: [154, 270, 444, 498], Verona: [90, 135, 209, 287], Padova: [311, 355, 380, 413, 415, 461, 503, 522, 526],
  Trieste: [237, 289, 300, 341, 447, 546], Cagliari: [307, 416, 445], Perugia: [225, 246, 257, 322, 417, 500, 543],
  Pescara: [94, 371, 501, 524], Lecce: [184, 288, 344, 545], Parma: [52, 146, 358, 373, 531, 552], Modena: [129, 248, 324, 357],
  'Reggio Emilia': [145, 190, 325, 550], Salerno: [80, 85, 384], Bolzano: [100, 152, 174, 180, 375, 433], Trento: [283, 334, 335, 406],
  Udine: [331, 361, 405, 517], Rimini: [273, 326, 327, 328, 360], Pisa: [194, 382, 383, 449, 450, 483], Cosenza: [89, 220, 234, 296, 431],
  Messina: [172, 202, 317, 362], Treviso: [330, 401, 471, 534, 554], Vicenza: [213, 294, 305, 516], Ferrara: [251, 333, 424, 488],
  Toscana: [323, 468, 466, 343, 226, 262, 395, 346, 571, 232, 292], Sassari: [88, 490], Siracusa: [386, 428], Ancona: [199, 308, 321, 463, 464],
};
const scelti = []; let more = true;
for (let r = 0; more; r++) { more = false; for (const c in perCitta) if (perCitta[c][r] != null) { scelti.push(perCitta[c][r]); more = true; } }
const n = Number(process.argv[2]);
const P = scelti.slice((n - 1) * 22, n * 22).map((i) => L[i]);
console.log(scelti.length, P.map((a) => `${a.nome} [${a.citta}]`).join(' | '));
fs.writeFileSync(`out/giro${process.argv[3]}_ids.txt`, P.map((a) => a.id).join(','));
