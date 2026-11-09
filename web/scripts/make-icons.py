# Icone della PWA da Mimi' (richiesta di Dan del 09-11-2026: via le icone oro "amimi'", al loro posto Mimi').
#
# Sorgente: la Mimi' della pagina premi (supabase/functions/loyalty-page/src/mimi.webp, 498x540 con trasparenza).
# Scrive in web/public: icon-512.png e icon-192.png (purpose "any", quadrato tondo con gli angoli trasparenti, la 192
# e' anche l'icona grande delle notifiche), icon-180.png (apple-touch: pieno, iOS arrotonda da se'),
# icon-maskable-512.png (pieno, Mimi' dentro il cerchio sicuro dell'80%), favicon.svg (PNG 128 incorporato) e
# badge-96.png (icona piccola delle notifiche Android: conta solo l'alfa, sagoma bianca con gli occhiali scavati).
#
#   python -I web/scripts/make-icons.py [cartella-anteprima]
#
# Con la cartella d'anteprima scrive anche _contact_sheet.png (icone alle misure vere su fondi chiari e scuri).
# Solo numpy e Pillow.
import base64
import io
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

WEB = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(WEB, "..", "supabase", "functions", "loyalty-page", "src", "mimi.webp")
PUB = os.path.join(WEB, "public")

BG = (225, 10, 10)        # --red della pagina premi, il rosso di Mimi'
RAGGIO = 0.22             # angoli del quadrato tondo, come le icone di iOS
ALTEZZA = 0.84            # Mimi' (manico compreso) sull'altezza dell'icona
ALTEZZA_MASKABLE = 0.64   # i due angoli in basso della borsa restano dentro il cerchio sicuro (raggio 0.40)
PUNTO_DENTRO = (250, 400) # un pixel del corpo della borsa nella sorgente
RIGA_OCCHIALI = 366       # una riga della sorgente che attraversa le lenti


def carica():
    a = np.asarray(Image.open(SRC).convert("RGBA")).astype(np.int16)
    al = a[..., 3]
    a[..., 3] = np.where(al > 20, al, 0)  # via l'alone quasi trasparente attorno all'adesivo
    tutta = Image.fromarray(a.astype(np.uint8), "RGBA")
    # la borsa e' il pezzo connesso che contiene PUNTO_DENTRO; le due scintille sono pezzi a parte
    m = Image.fromarray(((a[..., 3] > 0) * 255).astype(np.uint8)).copy()
    ImageDraw.floodfill(m, PUNTO_DENTRO, 128)
    borsa = np.asarray(m) == 128
    return tutta, a, borsa


def riempi_buchi(mask):
    m = Image.fromarray((mask * 255).astype(np.uint8)).copy()
    ImageDraw.floodfill(m, (0, 0), 128)
    return np.asarray(m) != 128


def quadrato_tondo(size):
    big = Image.new("L", (size * 4, size * 4), 0)
    ImageDraw.Draw(big).rounded_rectangle((0, 0, size * 4 - 1, size * 4 - 1), radius=int(size * 4 * RAGGIO), fill=255)
    return big.resize((size, size), Image.LANCZOS)


def componi(art, size, altezza, tondo):
    crop = art.crop(art.getbbox())
    h = int(round(size * altezza))
    w = int(round(crop.width * h / crop.height))
    crop = crop.resize((w, h), Image.LANCZOS)
    tela = Image.new("RGBA", (size, size), BG + (255,))
    tela.alpha_composite(crop, ((size - w) // 2, (size - h) // 2))
    if tondo:
        tela.putalpha(quadrato_tondo(size))
    return tela


def badge(a, borsa, size):
    rgb = a[..., :3]
    # occhiali: il pezzo rosso scuro che passa per RIGA_OCCHIALI, preso solo all'interno della borsa (bordo bianco e
    # contorno restano pieni, cosi' la sagoma non ha tacche); i riflessi bianchi delle lenti si riempiono
    scuro = (rgb[..., 0] < 215) & (rgb[..., 1] < 80) & (rgb[..., 2] < 80)
    interno = np.asarray(Image.fromarray((borsa * 255).astype(np.uint8)).filter(ImageFilter.MinFilter(29))) > 0
    cand = scuro & interno
    xs = np.where(cand[RIGA_OCCHIALI])[0]
    if not len(xs):
        sys.exit(f"RIGA_OCCHIALI={RIGA_OCCHIALI} non attraversa gli occhiali: la sorgente e' cambiata, rileggi"
                 " RIGA_OCCHIALI e PUNTO_DENTRO sulla nuova mimi.webp")
    seme = (int(xs[np.argmin(np.abs(xs - borsa.shape[1] // 2))]), RIGA_OCCHIALI)
    m = Image.fromarray((cand * 255).astype(np.uint8)).copy()
    ImageDraw.floodfill(m, seme, 128)
    occhiali = riempi_buchi(np.asarray(m) == 128)
    sagoma = borsa & ~occhiali
    alfa = np.where(sagoma, a[..., 3], 0).astype(np.uint8)
    bianco = np.dstack([np.full_like(alfa, 255)] * 3 + [alfa])
    art = Image.fromarray(bianco, "RGBA")
    crop = art.crop(art.getbbox())
    lato = int(round(size * 0.92))
    cw = int(round(crop.width * lato / crop.height))
    crop = crop.resize((cw, lato), Image.LANCZOS)
    tela = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    tela.alpha_composite(crop, ((size - cw) // 2, (size - lato) // 2))
    return tela


def favicon_svg(icona128):
    buf = io.BytesIO()
    icona128.save(buf, "PNG", optimize=True)
    b64 = base64.b64encode(buf.getvalue()).decode()
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">'
            f'<image width="128" height="128" href="data:image/png;base64,{b64}"/></svg>\n')


def main():
    tutta, a, borsa = carica()
    any512 = componi(tutta, 512, ALTEZZA, True)
    out = {
        "icon-512.png": any512,
        "icon-192.png": componi(tutta, 192, ALTEZZA, True),
        "icon-180.png": componi(tutta, 180, ALTEZZA, False).convert("RGB"),
        "icon-maskable-512.png": componi(tutta, 512, ALTEZZA_MASKABLE, False).convert("RGB"),
        "badge-96.png": badge(a, borsa, 96),
    }
    for nome, img in out.items():
        img.save(os.path.join(PUB, nome), optimize=True)
    fav = componi(tutta, 128, ALTEZZA, True)
    with open(os.path.join(PUB, "favicon.svg"), "w", encoding="utf-8", newline="\n") as f:
        f.write(favicon_svg(fav))
    for nome in list(out) + ["favicon.svg"]:
        print(nome, os.path.getsize(os.path.join(PUB, nome)))

    if len(sys.argv) > 1:
        prev = sys.argv[1]
        os.makedirs(prev, exist_ok=True)
        foglio = Image.new("RGB", (1180, 700), (110, 110, 110))
        foglio.paste(any512, (20, 20), any512)
        mk = out["icon-maskable-512.png"].convert("RGBA")
        cerchio = Image.new("L", (512, 512), 0)
        ImageDraw.Draw(cerchio).ellipse((51, 51, 461, 461), fill=255)
        foglio.paste(mk.resize((256, 256), Image.LANCZOS), (560, 20))
        mk_c = mk.copy()
        mk_c.putalpha(cerchio)
        foglio.paste(mk_c.resize((256, 256), Image.LANCZOS), (840, 20), mk_c.resize((256, 256), Image.LANCZOS))
        for k, barra in enumerate(((255, 255, 255), (40, 41, 45))):
            y0 = 560 + k * 70
            ImageDraw.Draw(foglio).rectangle((0, y0, 1180, y0 + 64), fill=barra)
            x = 20
            for s in (48, 32, 16):
                ic = fav.resize((s, s), Image.LANCZOS)
                foglio.paste(ic, (x, y0 + 8), ic)
                x += s + 24
            for s in (96, 48, 24):
                b = out["badge-96.png"].resize((s, s), Image.LANCZOS)
                tinta = Image.new("RGBA", (s, s), (90, 90, 90, 255) if k == 0 else (255, 255, 255, 255))
                tinta.putalpha(b.getchannel("A"))
                foglio.paste(tinta, (x + 40, y0 + 4 + (56 - s) // 2 if s < 56 else y0 - 16), tinta)
                x += s + 30
        ap = out["icon-180.png"]
        foglio.paste(ap, (560, 300))
        foglio.paste(out["icon-192.png"], (760, 300), out["icon-192.png"])
        foglio.save(os.path.join(prev, "_contact_sheet.png"))
        print("anteprima ->", os.path.join(prev, "_contact_sheet.png"))


if __name__ == "__main__":
    main()
