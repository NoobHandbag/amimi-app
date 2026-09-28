#!/usr/bin/env bash
# Sweep 3 a blocchi di 10 zone: se Playwright cade, si perde un blocco solo. Riprova una volta i blocchi falliti.
cd "$(dirname "$0")/.."
Q="concept store,boutique donna,negozio accessori donna"
B=(
"Roma Testaccio,Roma Ostiense,Roma Monteverde,Roma Flaminio,Roma San Giovanni,Roma Centro Storico,Roma Trieste Salario,Roma EUR,Napoli Posillipo,Napoli Centro Storico"
"Torino Crocetta,Torino Vanchiglia,Torino Centro,Torino Cit Turin,Firenze Oltrarno,Firenze Campo di Marte,Firenze Centro,Bologna Santo Stefano,Bologna San Vitale,Genova Albaro"
"Genova Castelletto,Palermo Liberta,Catania centro,Bari Poggiofranco,Cagliari centro,Latina,Terni,Viterbo,Pistoia,Prato"
"Grosseto,Piacenza,Forli,Cesena,Asti,Alessandria,Cuneo,Pordenone,L'Aquila,Chieti"
"Foggia,Brindisi,Potenza,Matera,Cosenza,Catanzaro,Reggio Calabria,Trapani,Ragusa,Oristano"
)
for i in "${!B[@]}"; do
  for t in 1 2; do
    [ -s "out/seed_maps_italia3_$i.json" ] && break
    node seed_maps.mjs --cities "${B[$i]}" --queries "$Q" --max 25 --out "out/seed_maps_italia3_$i.json" >> out/seed_maps_italia3.log 2>&1
  done
  echo "blocco $i: $( [ -s out/seed_maps_italia3_$i.json ] && echo ok || echo FALLITO )"
done
