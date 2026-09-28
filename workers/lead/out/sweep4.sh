#!/usr/bin/env bash
# Sweep 4 (28-09): query 'boutique multimarca' e 'negozio multimarca donna' nelle grandi e medie citta', a blocchi di 10.
cd "$(dirname "$0")/.."
Q="boutique multimarca,negozio multimarca donna"
B=(
"Roma,Napoli,Torino,Firenze,Bologna,Genova,Palermo,Bari,Catania,Venezia"
"Verona,Padova,Trieste,Cagliari,Perugia,Pescara,Ancona,Lecce,Salerno,Reggio Emilia"
"Parma,Modena,Pisa,Lucca,Livorno,Siena,Arezzo,Prato,Rimini,Ferrara"
"Vicenza,Treviso,Udine,Trento,Bolzano,Messina,Siracusa,Cosenza,Sassari,Latina"
)
for i in "${!B[@]}"; do
  for t in 1 2; do
    [ -s "out/seed_maps_italia4_$i.json" ] && break
    node seed_maps.mjs --cities "${B[$i]}" --queries "$Q" --max 25 --out "out/seed_maps_italia4_$i.json" >> out/seed_maps_italia4.log 2>&1
  done
  echo "blocco $i: $( [ -s out/seed_maps_italia4_$i.json ] && echo ok || echo FALLITO )"
done
