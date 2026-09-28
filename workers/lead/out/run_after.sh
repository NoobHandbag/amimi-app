#!/usr/bin/env bash
# Aspetta la fine dei giri in $1 (es. "43 44 45"), poi lancia in parallelo i giri in $2 (file out/giroN_s.txt) e aspetta.
cd "$(dirname "$0")/.."
for g in $1; do until grep -q "\[collect\] fine" out/giro$g.log; do sleep 30; done; done
echo "fatti: $1"
for g in $2; do node collect.mjs --ids "$(cat out/giro${g}_s.txt)" > out/giro$g.log 2>&1 & done
wait
echo "fatti: $2"
