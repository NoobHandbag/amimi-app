import os, base64
import numpy as np
from PIL import Image
from scipy import ndimage

SRC = r"C:/Users/super/Downloads/Gemini_Generated_Image_lfacn4lfacn4lfac.png"
OUT = os.path.dirname(os.path.abspath(__file__))
PREV = os.path.join(OUT, "preview")
os.makedirs(PREV, exist_ok=True)

im = Image.open(SRC).convert("RGBA")
a = np.asarray(im).astype(np.int16)
rgb = a[..., :3]
sat = rgb.max(2) - rgb.min(2)

# 1) icon = saturated (pink/gold/beige) region -> excludes neutral checkerboard + gray shadow
colored = sat >= 22
colored = ndimage.binary_closing(colored, iterations=2)          # bridge tiny gaps
icon = ndimage.binary_fill_holes(colored)                        # fill cream interior holes
# keep only the largest connected component (the icon)
lbl, n = ndimage.label(icon)
if n > 1:
    sizes = ndimage.sum(np.ones_like(lbl), lbl, range(1, n + 1))
    icon = lbl == (1 + int(np.argmax(sizes)))

ys, xs = np.where(icon)
x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
print("icon bbox:", x0, x1, y0, y1, "w", x1 - x0 + 1, "h", y1 - y0 + 1)

# crop to a centered square
w, h = x1 - x0 + 1, y1 - y0 + 1
side = max(w, h)
cx, cy = (x0 + x1) // 2, (y0 + y1) // 2
sx0, sy0 = cx - side // 2, cy - side // 2
sx1, sy1 = sx0 + side, sy0 + side
# clamp
sx0 = max(0, sx0); sy0 = max(0, sy0)
sx1 = min(a.shape[1], sx1); sy1 = min(a.shape[0], sy1)

crop_rgb = rgb[sy0:sy1, sx0:sx1].astype(np.uint8)
crop_mask = icon[sy0:sy1, sx0:sx1]

# 2) replicate icon color outward into corners (kills gray halo + gives opaque fill)
solid = ndimage.binary_erosion(crop_mask, iterations=1)
# nearest opaque pixel index for every pixel
idx = ndimage.distance_transform_edt(~solid, return_distances=False, return_indices=True)
filled_rgb = crop_rgb[tuple(idx)]  # every pixel now carries nearest icon color

# 3) soft anti-aliased alpha from the mask
alpha_soft = ndimage.gaussian_filter(crop_mask.astype(np.float32) * 255.0, sigma=1.1)
alpha_soft = np.clip(alpha_soft, 0, 255).astype(np.uint8)

MASTER_T = np.dstack([filled_rgb, alpha_soft])                      # transparent rounded corners
MASTER_O = np.dstack([filled_rgb, np.full(alpha_soft.shape, 255, np.uint8)])  # opaque full-bleed

master_t = Image.fromarray(MASTER_T, "RGBA")
master_o = Image.fromarray(MASTER_O, "RGBA")
print("master size:", master_t.size)

def save_t(size, path):
    master_t.resize((size, size), Image.LANCZOS).save(path)

def save_o(size, path):
    master_o.convert("RGB").resize((size, size), Image.LANCZOS).save(path)

def save_maskable(size, path, scale=0.90):
    # solid pink background sampled from icon center-bottom (dominant leather pink)
    inner = int(round(size * scale))
    art = master_o.resize((inner, inner), Image.LANCZOS)
    bg_rgb = tuple(int(v) for v in np.median(crop_rgb[crop_mask].reshape(-1, 3), axis=0))
    canvas = Image.new("RGB", (size, size), bg_rgb)
    off = (size - inner) // 2
    canvas.paste(art, (off, off))
    canvas.save(path)
    return bg_rgb

# ---- write the deliverables into preview/ ----
save_t(512, os.path.join(PREV, "icon-512.png"))
save_t(192, os.path.join(PREV, "icon-192.png"))
save_o(180, os.path.join(PREV, "icon-180.png"))
bg = save_maskable(512, os.path.join(PREV, "icon-maskable-512.png"))
print("maskable bg pink:", bg)

# favicon.svg embedding a transparent 128px PNG
fav = os.path.join(PREV, "_favicon128.png")
master_t.resize((128, 128), Image.LANCZOS).save(fav)
b64 = base64.b64encode(open(fav, "rb").read()).decode()
svg = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">'
       f'<image width="128" height="128" href="data:image/png;base64,{b64}"/></svg>\n')
open(os.path.join(PREV, "favicon.svg"), "w", encoding="utf-8").write(svg)
print("favicon.svg bytes:", len(svg))

# contact sheet for quick visual QA
sheet = Image.new("RGBA", (512 * 2 + 30, 512 * 2 + 30), (128, 128, 128, 255))
sheet.paste(master_t.resize((512, 512)), (0, 0), master_t.resize((512, 512)))
sheet.paste(Image.open(os.path.join(PREV, "icon-maskable-512.png")).convert("RGBA"), (522, 0))
sheet.paste(master_o.resize((512, 512)).convert("RGBA"), (0, 522))
sheet.paste(master_t.resize((180, 180)), (522, 522), master_t.resize((180, 180)))
sheet.convert("RGB").save(os.path.join(PREV, "_contact_sheet.png"))
# fringe check: transparent icon-512 composited on black and white
i512 = Image.open(os.path.join(PREV, "icon-512.png")).convert("RGBA")
check = Image.new("RGB", (512 * 2 + 20, 512), (255, 255, 255))
blk = Image.new("RGBA", (512, 512), (0, 0, 0, 255)); blk.alpha_composite(i512)
wht = Image.new("RGBA", (512, 512), (255, 255, 255, 255)); wht.alpha_composite(i512)
check.paste(blk.convert("RGB"), (0, 0)); check.paste(wht.convert("RGB"), (532, 0))
check.save(os.path.join(PREV, "_fringe_check.png"))

print("done ->", PREV)
for f in sorted(os.listdir(PREV)):
    print("  ", f, os.path.getsize(os.path.join(PREV, f)))
