#!/usr/bin/env bash
# Controllo di aderenza al Design System Amimì v2 (DESIGN.md, root del repo).
#
# Non e' un linter di stile: verifica le poche regole che, se saltano, fanno
# tornare l'app indietro — un hex scritto a mano in un componente, un colore
# ritirato che rientra, un controllo bordato con --hairline (che non passa WCAG
# 1.4.11), Fraunces montato fuori dagli heading.
#
#   bash web/scripts/check-design-system.sh
#
# Esce 1 al primo criterio fallito, cosi' si puo' agganciare a una CI.

set -u
cd "$(dirname "$0")/../.." || exit 1
FAIL=0
ok() { printf '  OK   %s\n' "$1"; }
ko() { printf '  KO   %s\n' "$1"; FAIL=1; }

echo "=== Design System Amimì v2 — criteri di accettazione ==="

[ -f DESIGN.md ] && ok "DESIGN.md alla root del repo" || ko "manca DESIGN.md alla root"

cd web || exit 1

# 1. Un solo file definisce colori.
fuori=$(grep -rlniE '#[0-9a-f]{6}\b' src/ --include=*.css --include=*.tsx --include=*.ts \
        | grep -v 'styles/tokens.css' \
        | xargs -r grep -lniE '^[^/*]*#[0-9a-f]{6}')
[ -z "$fuori" ] && ok "solo src/styles/tokens.css definisce colori" \
  || { ko "hex hardcoded fuori da tokens.css:"; echo "$fuori" | sed 's/^/       /'; }

# 2. La palette GEEIQ e' fuori dal sistema (criterio esplicito del brief).
grep -rqniE '#(7c68fb|2e204d|fc4f3f|b380e5|e6476f|00bd9d|faf7f2)' src/ \
  && ko "hex GEEIQ ancora presenti in src/" || ok "nessun hex GEEIQ in src/"
grep -rqniE '#(5b35f2|4c23de|d5d5ff|3a2668|c51f10|ffcbc6|028371|d8f5ec|ff8614|c74d07|ffdea8|f3eee5|ece6db|e3dccf|6b6580)\b' src/ \
  && ko "altri colori ritirati (DESIGN.md §2.6) ancora presenti" || ok "nessun altro colore ritirato"

# 3. Niente gradienti decorativi.
grep -rq 'grad-hero\|grad-brand\|grad-action' src/ \
  && ko "gradienti decorativi ancora referenziati" || ok "gradienti decorativi rimossi"

# 4. Tipografia.
grep -q 'fontsource-variable/fraunces' src/main.tsx \
  && ok "Fraunces self-hosted" || ko "Fraunces non importato da @fontsource-variable"
if grep -q 'var(--font-display)' src/index.css src/styles/components.css 2>/dev/null; then
  ko "--font-display montato fuori da tokens.css (deve valere solo per h1,h2,h3,.display)"
else
  ok "Fraunces solo su h1, h2, h3, .display"
fi
grep -q 'Amimi Numerals' src/styles/tokens.css \
  && ok "cifre in Roboto anche dentro gli heading (fallback Amimi Numerals)" \
  || ko "manca il fallback numerico: un numero puo' finire in Fraunces"
grep -q 'font-feature-settings: var(--num)' src/styles/tokens.css \
  && ok 'numeri con "tnum" 1, "lnum" 1' || ko "cifre tabellari non impostate"

# 5. Product tile: --surface-photo, senza bordo ne' ombra (DESIGN.md §5.4).
if grep -nE '(\.pimg|\.invimg|\.tdimg|\.ds-thumb|\.ds-pcard-img|\.ds-picked-img|\.ai-pc-im)[^{]*\{[^}]*(border: 1px|box-shadow: var\(--e)' \
     src/index.css src/styles/components.css > /dev/null; then
  ko "un contenitore di foto prodotto ha bordo o ombra"
else
  ok "foto prodotto su --surface-photo, senza bordo ne ombra"
fi

# 6. --hairline non delimita mai un controllo (WCAG 1.4.11: sta a 1.24:1).
if grep -nE '(input|textarea|select|\.track|\.chip|\.fchip|\.kpichip|\.cs-chip|\.cs-fpill|\.seg |\.supcard|\.hit|\.stepbtn|\.qbox|\.cbox|\.dbox|\.pinmini|\.drawerx|\.minibtn|\.ai-field|\.ai-x)[^{]*\{[^}]*border:[^};]*var\(--(line|border|hairline)\)' \
     src/index.css src/styles/components.css > /dev/null; then
  ko "un controllo e' bordato con --hairline: usa --edge"
else
  ok "nessun controllo bordato con --hairline"
fi

# 7. Focus e movimento.
grep -q 'outline: var(--focus-ring) solid var(--focus)' src/styles/tokens.css \
  && ok "focus ring 2px --brand, offset 2px" || ko "focus ring non definito"
grep -q 'prefers-reduced-motion: reduce' src/styles/tokens.css \
  && ok "prefers-reduced-motion azzera il movimento" || ko "prefers-reduced-motion non gestito"

# 8. Icone e emoji.
grep -q 'strokeWidth={1.75}' src/components/Icon.tsx \
  && ok "icone a linea, stroke 1.75, currentColor" || ko "stroke delle icone diverso da 1.75"
if python3 - <<'PY'
import re, pathlib, sys
pat = re.compile('[\U0001F000-\U0001FAFF←-⇿⌀-⏿■-➿⬀-⯿️]')
bad = []
for f in list(pathlib.Path('src').rglob('*.tsx')) + list(pathlib.Path('src').rglob('*.ts')):
    for i, line in enumerate(f.read_text().splitlines(), 1):
        st = line.strip()
        if st.startswith(('//', '/*', '*')):
            continue
        # le frecce dentro una frase sono punteggiatura, non pittogrammi
        hits = [c for c in pat.findall(line) if c not in '→←–—']
        if hits:
            bad.append(f'{f}:{i} {"".join(hits)}')
sys.exit(1 if bad else 0)
PY
then ok "nessuna emoji nell'interfaccia"; else ko "emoji ancora presenti nell'interfaccia"; fi

echo
[ "$FAIL" -eq 0 ] && echo "Tutti i criteri superati." || echo "Almeno un criterio non superato."
exit "$FAIL"
