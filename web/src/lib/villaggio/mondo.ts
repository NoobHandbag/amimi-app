// Villaggio (16-10): il mondo three.js, un'isola in vista 3/4 con il magazzino (una pedana per modello, una pila per
// variante) e i laboratori (capannoni con un carrello per variante in lavorazione). Riceve dati gia' pronti dalla pagina
// e non scrive niente: le scritture passano dai componenti di Ordini (ArrivoRow, SupplierOrderForm) montati nella pagina.
// Scala unica: una lastra della pila = 2 pezzi, in magazzino (quello che c'e') e sui carrelli (quello che deve arrivare).
import * as THREE from 'three';
import { lastre } from './catalogo';
import type { Look, Modello } from './catalogo';

export type RigaMondo = { id: string; codice: string; model: Modello; look: Look; label: string; a: number; o: number; late: boolean };
export type LabMondo = { key: string; nome: string; tipo: string; righe: RigaMondo[] };
export type PilaMondo = { key: string; model: Modello; look: Look; name: string; stock: number; incoming: number };
export type DatiMondo = { labs: LabMondo[]; pile: PilaMondo[]; totale: number };
export type EventiMondo = { onLab: (key: string) => void; onMagazzino: (model?: Modello) => void; onGinni: () => void; onCarro: () => void };
type Ctx = { type: string; lab?: string } | null;
type Anchor = { el: HTMLElement; pos: THREE.Vector3; cond?: (now: number) => boolean; free?: boolean; w?: number; until?: number };
type Tween = { t0: number; dur: number; fn: (p: number) => void; done?: () => void; dead?: boolean };

const V3 = THREE.Vector3;
// colori come nel prototipo: niente conversione sRGB (le texture sono gia' i colori giusti)
THREE.ColorManagement.enabled = false;
const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');
const mix = (a: number, b: number, t: number) => new THREE.Color(a).lerp(new THREE.Color(b), t).getHex();
const rgba = (c: number, a: number) => 'rgba(' + ((c >> 16) & 255) + ',' + ((c >> 8) & 255) + ',' + (c & 255) + ',' + a + ')';
const esc = (s: string) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
function rngFor(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  let st = (h >>> 0) % 2147483646 + 1;
  return () => { st = (st * 16807) % 2147483647; return (st - 1) / 2147483646; };
}
const back = (p: number) => { const c = 1.70158; return 1 + (c + 1) * Math.pow(p - 1, 3) + c * Math.pow(p - 1, 2); };
const easeIO = (p: number) => (p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2);

/* ---------- texture disegnate: una per finitura e colori ---------- */
function rrPath(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath(); g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r); g.lineTo(x + w, y + h - r);
  g.quadraticCurveTo(x + w, y + h, x + w - r, y + h); g.lineTo(x + r, y + h); g.quadraticCurveTo(x, y + h, x, y + h - r); g.lineTo(x, y + r);
  g.quadraticCurveTo(x, y, x + r, y); g.closePath();
}
function paint(look: Look): HTMLCanvasElement {
  const S = 128, cv = document.createElement('canvas'); cv.width = cv.height = S;
  const g = cv.getContext('2d') as CanvasRenderingContext2D;
  const R = rngFor(look.key);
  const c0 = look.cols[0], c1 = look.cols[1];
  const fill = (c: number) => { g.fillStyle = hex(c); g.fillRect(0, 0, S, S); };
  const wrap = (cx: number, cy: number, fn: (x: number, y: number) => void) => { for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) fn(cx + ox, cy + oy); };
  const specks = (n: number, a: number, sz: number) => { for (let i = 0; i < n; i++) { g.fillStyle = R() < 0.5 ? 'rgba(255,255,255,' + a + ')' : 'rgba(0,0,0,' + a + ')'; g.fillRect(R() * S, R() * S, sz, sz); } };
  const blob = (cx: number, cy: number, r: number) => {
    const pts: number[] = []; for (let i = 0; i < 10; i++) pts.push(r * (0.65 + R() * 0.55));
    wrap(cx, cy, (x, y) => { g.beginPath(); pts.forEach((rr, i) => { const a = i / 10 * 6.283; const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr * 0.8; if (i) g.lineTo(px, py); else g.moveTo(px, py); }); g.closePath(); g.fill(); });
  };
  const flower = (x: number, y: number, r: number, petal: string, center: string) => {
    g.fillStyle = petal; for (let k = 0; k < 5; k++) { const a = k / 5 * 6.283; g.beginPath(); g.arc(x + Math.cos(a) * r, y + Math.sin(a) * r, r * 0.8, 0, 6.283); g.fill(); }
    g.fillStyle = center; g.beginPath(); g.arc(x, y, r * 0.6, 0, 6.283); g.fill();
  };
  switch (look.fin) {
    case 'cocco': {
      fill(c0);
      const rows = 6, h = S / rows; g.lineWidth = 2.4; g.strokeStyle = hex(mix(c0, 0x000000, 0.5));
      for (let r = 0; r < rows; r++) {
        let x = r % 2 ? -11 : 0;
        while (x < S) { const w = 18 + Math.floor(R() * 8); rrPath(g, x + 1.5, r * h + 1.5, w - 3, h - 3, 5); g.fillStyle = hex(mix(c0, 0xffffff, 0.05 + R() * 0.1)); g.fill(); g.stroke(); x += w; }
      }
      break;
    }
    case 'patent': {
      fill(c0); g.save(); g.rotate(-0.55);
      for (let k = 0; k < 4; k++) { g.fillStyle = 'rgba(255,255,255,' + (0.12 + R() * 0.12) + ')'; g.fillRect(-S, k * 44 - 40, 3 * S, 6 + R() * 8); }
      g.restore(); break;
    }
    case 'satin': {
      fill(c0); g.save(); g.rotate(-0.5);
      for (let k = 0; k < 7; k++) { g.fillStyle = 'rgba(255,255,255,' + (0.06 + R() * 0.12) + ')'; g.fillRect(-S, k * 26 - 50, 3 * S, 9 + R() * 8); }
      g.restore(); break;
    }
    case 'sequin': {
      fill(mix(c0, 0x000000, 0.28));
      for (let y = 0; y < S + 8; y += 8) for (let x = (y / 8) % 2 ? 4 : 0; x < S + 8; x += 8) {
        g.fillStyle = hex(mix(c0, 0xffffff, R() * 0.5)); g.beginPath(); g.arc(x, y, 3.7, 0, 6.283); g.fill();
        if (R() < 0.25) { g.fillStyle = 'rgba(255,255,255,0.9)'; g.beginPath(); g.arc(x - 1, y - 1, 1.2, 0, 6.283); g.fill(); }
      }
      break;
    }
    case 'suede': fill(c0); specks(2400, 0.07, 1.2); break;
    case 'leather': fill(c0); specks(500, 0.04, 2); break;
    case 'toasted': {
      fill(c0);
      for (let i = 0; i < 26; i++) {
        const x = R() * S, y = R() * S, r = 10 + R() * 22, light = R() < 0.5;
        wrap(x, y, (px, py) => { const gr = g.createRadialGradient(px, py, 0, px, py, r); gr.addColorStop(0, light ? 'rgba(255,220,170,0.28)' : 'rgba(40,15,0,0.3)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(px - r, py - r, r * 2, r * 2); });
      }
      break;
    }
    case 'pony': {
      if (look.print === 'zebra') {
        fill(c1); g.strokeStyle = hex(c0); g.lineCap = 'round';
        for (let i = 0; i < 7; i++) {
          g.lineWidth = 6 + R() * 5; const y0 = i * S / 7 + R() * 5; g.beginPath(); g.moveTo(-10, y0);
          for (let x = 0; x <= S + 10; x += 12) g.lineTo(x, y0 + Math.sin(x * 0.05 + i * 1.7) * 8 + (R() - 0.5) * 3);
          g.stroke();
        }
      } else if (look.print === 'cow') {
        fill(c1); g.fillStyle = hex(c0); for (let i = 0; i < 6; i++) blob(R() * S, R() * S, 12 + R() * 14);
      } else if (look.print === 'leopard') {
        fill(c0);
        for (let i = 0; i < 18; i++) {
          const x = R() * S, y = R() * S, r = 5 + R() * 3, a0 = R();
          wrap(x, y, (px, py) => {
            g.fillStyle = 'rgba(168,105,44,0.8)'; g.beginPath(); g.ellipse(px, py, r * 0.8, r * 0.6, 0, 0, 6.283); g.fill();
            g.strokeStyle = hex(c1); g.lineWidth = 3; for (let k = 0; k < 3; k++) { const a = k * 2.1 + a0; g.beginPath(); g.arc(px, py, r, a, a + 1.4); g.stroke(); }
          });
        }
      } else {
        fill(c0);
        for (let i = 0; i < 500; i++) { const x = R() * S, y = R() * S; g.strokeStyle = R() < 0.5 ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'; g.lineWidth = 1; g.beginPath(); g.moveTo(x, y); g.lineTo(x + 2, y + 5); g.stroke(); }
      }
      break;
    }
    case 'stripes': {
      const seq = c1 != null ? [c0, 0xffffff, c1, 0xffffff] : [c0, 0xffffff];
      for (let x = 0, i = 0; x < S; x += 16, i++) { g.fillStyle = hex(seq[i % seq.length]); g.fillRect(x, 0, 16, S); }
      break;
    }
    case 'checks': {
      fill(0xffffff);
      g.fillStyle = rgba(c0, 0.55); for (let x = 0; x < S; x += 32) g.fillRect(x, 0, 16, S);
      g.fillStyle = rgba(c1 != null ? c1 : c0, 0.55); for (let y = 0; y < S; y += 32) g.fillRect(0, y, S, 16);
      break;
    }
    case 'pois': {
      fill(0xfbf7ee); g.fillStyle = hex(c0);
      for (let y = 0; y < S; y += 32) for (let x = (y / 32) % 2 ? 16 : 0; x < S + 16; x += 32) { g.beginPath(); g.arc(x, y + 8, 6, 0, 6.283); g.fill(); }
      break;
    }
    case 'embroidery': {
      fill(c0);
      const pal = [0xf27a8c, 0xf6c84b, 0x6fbf8e, 0x5aa9e6, 0xb08ae0];
      for (let i = 0; i < 16; i++) {
        const x = R() * S, y = R() * S;
        const col = look.multi ? hex(pal[i % pal.length]) : hex(mix(c0, 0x8a7a60, 0.22));
        wrap(x, y, (px, py) => flower(px, py, 3.2, col, look.multi ? '#fff8ea' : hex(mix(c0, 0x8a7a60, 0.35))));
      }
      specks(300, 0.05, 1.5); break;
    }
    case 'roses': {
      fill(c0);
      const rc = c1 != null ? c1 : mix(c0, 0xd98aa0, 0.45);
      for (let i = 0; i < 8; i++) {
        const x = R() * S, y = R() * S, r = 8 + R() * 4;
        wrap(x, y, (px, py) => {
          g.fillStyle = 'rgba(110,160,95,0.85)'; g.beginPath(); g.ellipse(px + r, py + r * 0.5, r * 0.7, r * 0.35, 0.6, 0, 6.283); g.fill();
          g.fillStyle = hex(rc); g.beginPath(); g.arc(px, py, r, 0, 6.283); g.fill();
          g.strokeStyle = hex(mix(rc, 0x000000, 0.25)); g.lineWidth = 1.5; for (let k = 1; k < 4; k++) { g.beginPath(); g.arc(px, py, r * k / 4, k, k + 4.2); g.stroke(); }
        });
      }
      break;
    }
    case 'floral': {
      fill(c0);
      for (let i = 0; i < 16; i++) { const x = R() * S, y = R() * S; wrap(x, y, (px, py) => flower(px, py, 3, 'rgba(255,255,255,0.92)', '#f2c84b')); }
      break;
    }
    case 'organza': {
      fill(0xf6f3ee); g.strokeStyle = 'rgba(190,180,160,0.6)'; g.lineWidth = 1.2;
      for (let i = 0; i < 14; i++) { const x = R() * S, y = R() * S; wrap(x, y, (px, py) => { for (let k = 0; k < 5; k++) { const a = k / 5 * 6.283; g.beginPath(); g.arc(px + Math.cos(a) * 3, py + Math.sin(a) * 3, 2.6, 0, 6.283); g.stroke(); } }); }
      break;
    }
    case 'tiedye': {
      fill(0xfdf5f8);
      for (let i = 0; i < 10; i++) {
        const x = R() * S, y = R() * S, r = 16 + R() * 18;
        wrap(x, y, (px, py) => { const gr = g.createRadialGradient(px, py, 0, px, py, r); gr.addColorStop(0, rgba(c0, 0.75)); gr.addColorStop(0.6, rgba(c0, 0.3)); gr.addColorStop(1, rgba(c0, 0)); g.fillStyle = gr; g.fillRect(px - r, py - r, r * 2, r * 2); });
      }
      break;
    }
    default: {
      fill(c0); g.fillStyle = 'rgba(0,0,0,0.035)';
      for (let i = 0; i < S; i += 3) { g.fillRect(i, 0, 1, S); g.fillRect(0, i, S, 1); }
    }
  }
  return cv;
}
const REP: Partial<Record<string, number>> = { cocco: 1.6, sequin: 2.2, stripes: 1.1, checks: 1.3, pois: 1.3, embroidery: 1.4, floral: 1.4, roses: 1.2, organza: 1.4, tiedye: 1.0, pony: 1.0, satin: 1.0, patent: 1.0 };
const SHINE: Partial<Record<string, [number, number]>> = { cocco: [45, 0x3a3a3a], patent: [120, 0xdddddd], satin: [60, 0x888888], sequin: [100, 0xbbbbbb], leather: [22, 0x2a2a2a], toasted: [24, 0x2a2a2a] };
const FABRIC = new Set(['cotton', 'stripes', 'checks', 'pois', 'embroidery', 'roses', 'floral', 'organza', 'tiedye', 'sequin', 'satin']);
const CANV: Record<string, HTMLCanvasElement> = {};
const TEX: Record<string, THREE.CanvasTexture> = {};
type Mats = { body: THREE.Material; strap: THREE.Material; gold: THREE.Material; silver: THREE.Material; dark: THREE.Material };
const MATS: Record<string, Mats> = {};
export const canvasFor = (look: Look) => CANV[look.key] || (CANV[look.key] = paint(look));
function texFor(look: Look) {
  if (TEX[look.key]) return TEX[look.key];
  const t = new THREE.CanvasTexture(canvasFor(look));
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  const r = REP[look.fin] ?? 1.2;
  t.repeat.set(r, r);
  return TEX[look.key] = t;
}
const GOLD = new THREE.MeshPhongMaterial({ color: 0xd9b45a, shininess: 90, specular: 0xffffff });
const SILVER = new THREE.MeshPhongMaterial({ color: 0xd3d8de, shininess: 90, specular: 0xffffff });
const DARK = new THREE.MeshLambertMaterial({ color: 0x2a2626 });
function strapColor(look: Look) {
  if (look.print === 'zebra') return 0x1e1c21;
  if (look.print === 'cow') return look.cols[0];
  if (look.print === 'leopard') return 0x3a2414;
  return mix(look.cols[0], 0x000000, 0.22);
}
function matsFor(look: Look, ghost?: boolean): Mats {
  const k = look.key + (ghost ? 'g' : '');
  if (MATS[k]) return MATS[k];
  const t = texFor(look);
  const sh = SHINE[look.fin];
  const body: THREE.Material = sh ? new THREE.MeshPhongMaterial({ map: t, shininess: sh[0], specular: sh[1] }) : new THREE.MeshLambertMaterial({ map: t });
  const strap: THREE.Material = FABRIC.has(look.fin) ? body : new THREE.MeshPhongMaterial({ color: strapColor(look), shininess: 30, specular: 0x222222 });
  let M: Mats = { body, strap, gold: GOLD, silver: SILVER, dark: DARK };
  if (ghost) {
    const G = {} as Mats;
    for (const r of Object.keys(M) as (keyof Mats)[]) { const c = M[r].clone(); c.transparent = true; c.opacity = 0.3; c.depthWrite = false; G[r] = c; }
    M = G;
  }
  return MATS[k] = M;
}

/* ---------- sagome: una per modello, dalle foto del sito ---------- */
function rrectShape(w: number, h: number, r: number) {
  const s = new THREE.Shape(), x0 = -w / 2, x1 = w / 2;
  s.moveTo(x0 + r, 0); s.lineTo(x1 - r, 0); s.quadraticCurveTo(x1, 0, x1, r); s.lineTo(x1, h - r); s.quadraticCurveTo(x1, h, x1 - r, h);
  s.lineTo(x0 + r, h); s.quadraticCurveTo(x0, h, x0, h - r); s.lineTo(x0, r); s.quadraticCurveTo(x0, 0, x0 + r, 0);
  return s;
}
function trapShape(wb: number, wt: number, h: number, r: number) {
  const s = new THREE.Shape();
  s.moveTo(-wb / 2 + r, 0); s.lineTo(wb / 2 - r, 0); s.quadraticCurveTo(wb / 2, 0, wb / 2 - 0.004, r); s.lineTo(wt / 2, h); s.lineTo(-wt / 2, h);
  s.lineTo(-wb / 2 + 0.004, r); s.quadraticCurveTo(-wb / 2, 0, -wb / 2 + r, 0);
  return s;
}
function ellShape(w: number, h: number) { const s = new THREE.Shape(); s.absellipse(0, h / 2, w / 2, h / 2, 0, Math.PI * 2, false, 0); return s; }
function crescentShape(w: number, h: number) {
  const s = new THREE.Shape(); s.moveTo(-w / 2, h);
  s.absellipse(0, h, w / 2, h, Math.PI, Math.PI * 2, false, 0);
  s.quadraticCurveTo(0, h * 0.8, -w / 2, h);
  return s;
}
function sophieShape(w: number, h: number) {
  const s = new THREE.Shape();
  s.moveTo(-w * 0.42, h); s.lineTo(w * 0.42, h); s.quadraticCurveTo(w * 0.53, h * 0.95, w * 0.5, h * 0.55); s.quadraticCurveTo(w * 0.46, 0, 0, 0);
  s.quadraticCurveTo(-w * 0.46, 0, -w * 0.5, h * 0.55); s.quadraticCurveTo(-w * 0.53, h * 0.95, -w * 0.42, h);
  return s;
}
function ex(shape: THREE.Shape, depth: number, bev: number) {
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bev > 0, bevelThickness: bev, bevelSize: bev * 0.7, bevelSegments: 2, curveSegments: 14 });
  g.translate(0, bev * 0.7, -depth / 2);
  return g;
}
function lathe(pts: number[][]) {
  const g = new THREE.LatheGeometry(pts.map((p) => new THREE.Vector2(p[0], p[1])), 24);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2.2, uv.getY(i) * 0.75);
  return g;
}
const tube = (pts: THREE.Vector3[], r: number) => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 28, r, 6, false);
function arch(x0: number, x1: number, y: number, peak: number, r: number, z = 0) {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 8; i++) { const t = i / 8; pts.push(new V3(x0 + (x1 - x0) * t, y + (peak - y) * Math.sin(t * Math.PI), z)); }
  return tube(pts, r);
}
const ring = (r: number, t: number, x: number, y: number, z: number, ry = 0) => { const g = new THREE.TorusGeometry(r, t, 6, 16); if (ry) g.rotateY(ry); g.translate(x, y, z); return g; };
const hring = (r: number, t: number, y: number) => { const g = new THREE.TorusGeometry(r, t, 6, 22); g.rotateX(Math.PI / 2); g.translate(0, y, 0); return g; };
const ball = (r: number, x: number, y: number, z: number) => { const g = new THREE.SphereGeometry(r, 10, 8); g.translate(x, y, z); return g; };
const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);

type Part = [THREE.BufferGeometry, keyof Mats];
type Def = { parts: Part[]; slab: THREE.Shape; th: number };
type Geo = Def & { pierce: THREE.BufferGeometry[]; charm: THREE.BufferGeometry[]; w: number; h: number; slabGeo: THREE.BufferGeometry; sw: number; sd: number };
const MODEL_DEF: Record<Modello, () => Def> = {
  'Lea': () => ({ parts: [[ex(trapShape(0.8, 0.66, 0.82, 0.07), 0.1, 0.025), 'body'], [arch(-0.25, 0.25, 0.82, 1.5, 0.016), 'strap']], slab: trapShape(0.8, 0.66, 0.82, 0.07), th: 0.075 }),
  'Lea Maxi': () => ({ parts: [[ex(trapShape(1.0, 0.82, 1.06, 0.08), 0.12, 0.03), 'body'], [arch(-0.31, 0.31, 1.07, 1.95, 0.02), 'strap']], slab: trapShape(1.0, 0.82, 1.06, 0.08), th: 0.085 }),
  'Valentina': () => ({ parts: [[ex(trapShape(1.0, 0.82, 0.44, 0.1), 0.24, 0.05), 'body'], [arch(-0.28, 0.28, 0.47, 0.92, 0.028), 'strap']], slab: trapShape(1.0, 0.82, 0.44, 0.1), th: 0.11 }),
  'Sophie': () => ({ parts: [[ex(sophieShape(0.98, 0.56), 0.26, 0.06), 'body'], [arch(-0.33, 0.33, 0.58, 1.02, 0.03), 'strap'],
    [ring(0.045, 0.012, -0.33, 0.58, 0, Math.PI / 2), 'gold'], [ring(0.045, 0.012, 0.33, 0.58, 0, Math.PI / 2), 'gold']], slab: sophieShape(0.98, 0.56), th: 0.11 }),
  'Nina': () => ({ parts: [[ex(crescentShape(1.0, 0.5), 0.16, 0.05), 'body'], [arch(-0.46, 0.46, 0.52, 1.12, 0.035), 'strap']], slab: crescentShape(1.0, 0.5), th: 0.07 }),
  'Nina Maxi': () => ({ parts: [[ex(crescentShape(1.3, 0.66), 0.2, 0.06), 'body'], [arch(-0.6, 0.6, 0.68, 1.45, 0.04), 'strap']], slab: crescentShape(1.3, 0.66), th: 0.08 }),
  'Agata': () => ({ parts: [[ex(rrectShape(0.5, 0.6, 0.05), 0.1, 0.03), 'body'], [arch(-0.13, 0.13, 0.62, 0.84, 0.016, 0.04), 'strap'], [arch(-0.13, 0.13, 0.62, 0.84, 0.016, -0.04), 'strap']], slab: rrectShape(0.5, 0.6, 0.05), th: 0.06 }),
  'Annie': () => ({ parts: [[lathe([[0.001, 0], [0.2, 0.015], [0.29, 0.08], [0.32, 0.2], [0.28, 0.32], [0.17, 0.41], [0.12, 0.45], [0.17, 0.52], [0.22, 0.58], [0.2, 0.6]]), 'body'],
    [hring(0.125, 0.018, 0.45), 'strap'],
    [tube([new V3(0.06, 0.45, 0.11), new V3(0.12, 0.33, 0.24), new V3(0.15, 0.18, 0.27)], 0.012), 'strap'],
    [tube([new V3(-0.04, 0.45, 0.12), new V3(-0.06, 0.3, 0.26), new V3(-0.04, 0.16, 0.29)], 0.012), 'strap'],
    [ball(0.03, 0.15, 0.17, 0.27), 'silver'], [ball(0.03, -0.04, 0.15, 0.29), 'silver']], slab: ellShape(0.62, 0.6), th: 0.09 }),
  'Maria': () => ({ parts: [[lathe([[0.001, 0], [0.28, 0.01], [0.37, 0.07], [0.4, 0.28], [0.38, 0.48], [0.31, 0.6], [0.24, 0.66], [0.29, 0.74], [0.33, 0.8], [0.3, 0.82]]), 'body'],
    [hring(0.25, 0.02, 0.66), 'strap'],
    [tube([new V3(0.15, 0.66, 0.2), new V3(0.42, 0.42, 0.26), new V3(0.5, 0.04, 0.2)], 0.018), 'strap'],
    [tube([new V3(-0.15, 0.66, 0.2), new V3(-0.42, 0.42, 0.26), new V3(-0.5, 0.04, 0.2)], 0.018), 'strap'],
    [ball(0.035, 0.5, 0.04, 0.2), 'silver'], [ball(0.035, -0.5, 0.04, 0.2), 'silver']], slab: ellShape(0.8, 0.8), th: 0.1 }),
  'Airpod cover': () => ({ parts: [[ex(rrectShape(0.3, 0.36, 0.06), 0.07, 0.02), 'body'], [ring(0.06, 0.012, 0.19, 0.44, 0), 'gold'], [box(0.1, 0.04, 0.03).translate(0.13, 0.38, 0), 'strap']], slab: rrectShape(0.3, 0.36, 0.06), th: 0.05 }),
  'Sunglass cover': () => ({ parts: [[ex(rrectShape(0.62, 0.3, 0.05), 0.07, 0.02), 'body'], [ring(0.06, 0.012, 0.38, 0.33, 0), 'gold']], slab: rrectShape(0.62, 0.3, 0.05), th: 0.05 }),
  'Laptop cover': () => {
    const f = new THREE.Shape(); f.moveTo(-0.47, 0.68); f.lineTo(0.47, 0.68); f.lineTo(0.06, 0.37); f.quadraticCurveTo(0, 0.33, -0.06, 0.37); f.lineTo(-0.47, 0.68);
    const flap = new THREE.ExtrudeGeometry(f, { depth: 0.012, bevelEnabled: false }); flap.translate(0, 0.01, 0.046);
    return { parts: [[ex(rrectShape(0.95, 0.68, 0.05), 0.05, 0.015), 'body'], [flap, 'body']], slab: rrectShape(0.95, 0.68, 0.05), th: 0.045 };
  },
  'Porta carte': () => ({ parts: [[ex(rrectShape(0.38, 0.27, 0.04), 0.04, 0.012), 'body'], [box(0.28, 0.014, 0.012).translate(0, 0.2, 0.034), 'dark']], slab: rrectShape(0.38, 0.27, 0.04), th: 0.04 }),
};
const GEO: Partial<Record<Modello, Geo>> = {};
function partsFor(model: Modello): Geo {
  const got = GEO[model];
  if (got) return got;
  const d = MODEL_DEF[model]();
  const body = d.parts[0][0]; body.computeBoundingBox();
  const bb = body.boundingBox as THREE.Box3;
  const all = new THREE.Box3(); d.parts.forEach(([g]) => { g.computeBoundingBox(); all.union(g.boundingBox as THREE.Box3); });
  const w = bb.max.x - bb.min.x, top = bb.max.y, zf = bb.max.z;
  const pierce = [-0.28, 0, 0.28].map((f) => ring(0.034, 0.009, f * w, top - 0.13 * top - 0.04, zf + 0.004));
  const charm: THREE.BufferGeometry[] = [];
  [-0.18, 0, 0.18].forEach((f, i) => { charm.push(ball(0.035, f * w, top - 0.12 - (i % 2) * 0.05, zf + 0.03)); charm.push(new THREE.CylinderGeometry(0.006, 0.006, 0.09, 5).translate(f * w, top - 0.06, zf + 0.02)); });
  const sg = new THREE.ExtrudeGeometry(d.slab, { depth: d.th, bevelEnabled: false, curveSegments: 10 });
  sg.rotateX(-Math.PI / 2); sg.computeBoundingBox();
  const sb = sg.boundingBox as THREE.Box3; sg.translate(-(sb.min.x + sb.max.x) / 2, 0, -(sb.min.z + sb.max.z) / 2);
  const g: Geo = { ...d, pierce, charm, w, h: all.max.y, slabGeo: sg, sw: sb.max.x - sb.min.x, sd: sb.max.z - sb.min.z };
  return GEO[model] = g;
}
function makeBag(model: Modello, look: Look, o: { ghost?: boolean; noShadow?: boolean } = {}) {
  const P = partsFor(model);
  const M = matsFor(look, o.ghost);
  const g = new THREE.Group();
  const put = (geo: THREE.BufferGeometry, m: THREE.Material, cast: boolean) => { const me = new THREE.Mesh(geo, m); me.castShadow = !o.noShadow && cast; me.receiveShadow = true; g.add(me); };
  for (const [geo, role] of P.parts) put(geo, M[role] || M.body, role !== 'gold' && role !== 'silver');
  if (look.piercing) P.pierce.forEach((geo) => put(geo, M.silver, false));
  if (look.charm) P.charm.forEach((geo) => put(geo, M.gold, false));
  return g;
}
export const PSC = (m: Modello) => (/cover|carte/.test(m) ? 1 : 0.8);

/* ---------- miniature 3D per i pannelli: un secondo renderer piccolo, condiviso ---------- */
let TR: THREE.WebGLRenderer | null = null, TS: THREE.Scene | null = null, TC: THREE.PerspectiveCamera | null = null;
const THC: Record<string, string> = {};
export function thumb(model: Modello, look: Look): string {
  const k = model + '|' + look.key;
  if (THC[k]) return THC[k];
  if (!TR) {
    TR = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    TR.outputColorSpace = THREE.LinearSRGBColorSpace;
    TR.setPixelRatio(1); TR.setSize(144, 144);
    TS = new THREE.Scene();
    TS.add(new THREE.HemisphereLight(0xfff6e2, 0x9a8a70, 0.72 * Math.PI));
    const dl = new THREE.DirectionalLight(0xffffff, 0.6 * Math.PI); dl.position.set(2, 5, 6); TS.add(dl);
    TC = new THREE.PerspectiveCamera(28, 1, 0.05, 50);
  }
  const scene = TS as THREE.Scene, cam = TC as THREE.PerspectiveCamera;
  const b = makeBag(model, look, { noShadow: true });
  b.rotation.y = 0.32;
  scene.add(b); b.updateMatrixWorld(true);
  const bb = new THREE.Box3().setFromObject(b);
  const c = bb.getCenter(new V3()), s = bb.getSize(new V3());
  const r = Math.max(s.x, s.y, s.z * 1.4) * 0.56;
  cam.position.copy(c).addScaledVector(new V3(0.25, 0.3, 1).normalize(), r / Math.tan(THREE.MathUtils.degToRad(14)));
  cam.lookAt(c);
  TR.render(scene, cam);
  const url = TR.domElement.toDataURL('image/png');
  scene.remove(b);
  return THC[k] = url;
}
/** Miniature in coda: al massimo ~12 ms per frame, cosi' un pannello con 80 borse non blocca la pagina. */
const THQ: [Modello, Look, (u: string) => void][] = [];
let thBusy = false;
export function thumbAsync(model: Modello, look: Look, cb: (u: string) => void) {
  const k = model + '|' + look.key;
  if (THC[k]) { cb(THC[k]); return; }
  THQ.push([model, look, cb]);
  if (thBusy) return;
  thBusy = true;
  const step = () => {
    const t0 = performance.now();
    while (THQ.length && performance.now() - t0 < 12) { const [m, l, c] = THQ.shift() as [Modello, Look, (u: string) => void]; c(thumb(m, l)); }
    if (THQ.length) requestAnimationFrame(step); else thBusy = false;
  };
  requestAnimationFrame(step);
}

/* ---------- decori: insegne, assi, lamiera ---------- */
function plankMat(c: number) {
  const cv = document.createElement('canvas'); cv.width = 128; cv.height = 64;
  const x = cv.getContext('2d') as CanvasRenderingContext2D;
  x.fillStyle = hex(c); x.fillRect(0, 0, 128, 64);
  for (let i = 0; i < 128; i += 16) { x.fillStyle = 'rgba(0,0,0,0.10)'; x.fillRect(i, 0, 2, 64); x.fillStyle = 'rgba(255,255,255,0.10)'; x.fillRect(i + 2, 0, 3, 64); }
  const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(3, 1);
  return new THREE.MeshLambertMaterial({ map: t });
}
function tinMat(c: number) {
  const cv = document.createElement('canvas'); cv.width = 64; cv.height = 8;
  const x = cv.getContext('2d') as CanvasRenderingContext2D;
  for (let i = 0; i < 64; i += 8) { x.fillStyle = hex(c); x.fillRect(i, 0, 5, 8); x.fillStyle = hex(mix(c, 0x000000, 0.2)); x.fillRect(i + 5, 0, 3, 8); }
  const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(7, 1);
  return new THREE.MeshLambertMaterial({ map: t });
}
function signMat(text: string, sub: string, c: number, w = 512) {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = 128;
  const t = new THREE.CanvasTexture(cv);
  const draw = () => {
    const x = cv.getContext('2d') as CanvasRenderingContext2D;
    x.clearRect(0, 0, w, 128);
    if (sub) { x.fillStyle = '#fff8ea'; rrPath(x, 4, 4, w - 8, 120, 26); x.fill(); x.lineWidth = 8; x.strokeStyle = hex(c); x.stroke(); }
    x.textAlign = 'center'; x.textBaseline = 'middle'; x.lineJoin = 'round';
    if (sub) {
      x.fillStyle = hex(mix(c, 0x000000, 0.35));
      x.font = '700 52px Fredoka, "Arial Rounded MT Bold", sans-serif'; x.fillText(text, w / 2, 52, w - 40);
      x.font = '600 28px Fredoka, "Arial Rounded MT Bold", sans-serif'; x.fillText(sub, w / 2, 97, w - 40);
    } else {
      x.font = '700 92px Fredoka, "Arial Rounded MT Bold", sans-serif';
      x.lineWidth = 16; x.strokeStyle = hex(c); x.strokeText(text, w / 2, 68); x.fillStyle = '#fff8ea'; x.fillText(text, w / 2, 68);
    }
    t.needsUpdate = true;
  };
  draw();
  if (document.fonts && document.fonts.load) document.fonts.load('700 52px Fredoka').then(draw).catch(() => undefined);
  return new THREE.MeshBasicMaterial({ map: t, transparent: true });
}

/* ---------- geometria del villaggio ---------- */
const WX0 = -16, WX1 = 2, WZ0 = -13, WZ1 = -1, WCX = (WX0 + WX1) / 2, WCZ = (WZ0 + WZ1) / 2, WW = WX1 - WX0, WD = WZ1 - WZ0;
const LAB_W = 6.4, LAB_D = 6.0, LAB_COLS = 5, LAB_CELL = 1.12, LAB_ROW = 1.1;
/* posti dei capannoni (ordine alfabetico dei fornitori con righe aperte): oltre 6 restano nei pannelli, non sull'isola */
const LAB_SLOTS: [number, number][] = [[-7, 10], [10, -8], [4, 11], [12, 3], [-15.5, 1.5], [17, -2]];
const LAB_COLORS = [0x5fbfa6, 0xd0663f, 0xa98bd8, 0xb9553d, 0xe0a32f, 0x6f9ad8];
const LAB_SHIRTS: [number, number][] = [[0xf2b84b, 0xb0532e], [0x5b8fd6, 0x4a3222], [0xe98aa6, 0x8a5a34], [0x3f8f6a, 0x2f2a28], [0x9a7fd1, 0x3a2a20], [0xd2563f, 0x6b4428]];
export const labColor = (i: number) => LAB_COLORS[i % LAB_COLORS.length];
const CART_HOME = new V3(4.5, 0, -1.2);
const MAXCOLS: Partial<Record<Modello, number>> = { Lea: 5, 'Lea Maxi': 3, Valentina: 2, Sophie: 3, Maria: 3, 'Nina Maxi': 3, Nina: 5, Agata: 4, Annie: 4, 'Laptop cover': 4, 'Sunglass cover': 3, 'Airpod cover': 3, 'Porta carte': 5 };
const ZROWS: Modello[][] = [['Lea', 'Lea Maxi', 'Valentina', 'Sophie'], ['Maria', 'Nina Maxi', 'Nina', 'Agata', 'Annie'], ['Laptop cover', 'Sunglass cover', 'Airpod cover', 'Porta carte']];
const OFF = new V3(32, 38, 32);
const EL = Math.atan2(OFF.y, Math.hypot(OFF.x, OFF.z));
const AWAY = new V3(-1, 0, -1).normalize();
const RIGHT = new V3(1, 0, -1).normalize();

type LabG = { g: THREE.Group; yard: THREE.Group; ch: THREE.Group; puffs: THREE.Mesh[]; hideSlot: THREE.Group; rollSlot: THREE.Group; spoolSlot: THREE.Group; dock: THREE.Vector3; anchor: Anchor; pileAnchors: Anchor[]; data: LabMondo; index: number };
type PilaG = PilaMondo & { x: number; z: number; cell: number; top: number; g: THREE.Group; anchor: Anchor };
type Zona = { x: number; z: number; w: number; d: number; anchor: Anchor };

export class Mondo {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 400);
  private target: THREE.Vector3;
  private viewH: number;
  private portrait: boolean;
  private tweens: Tween[] = [];
  private anchors: Anchor[] = [];
  private ctx: Ctx = null;
  private camTw: Tween | null = null;
  private camDest: { t: THREE.Vector3; v: number } | null = null;
  private savedView: { t: THREE.Vector3; v: number } | null = null;
  private raf = 0;
  private reduce: boolean;
  private wh = new THREE.Group();
  private whInside = new THREE.Group();
  private whA: Anchor;
  private labs = new Map<string, LabG>();
  private piles = new Map<string, PilaG>();
  private zones = new Map<Modello, Zona>();
  private ginni: THREE.Group;
  private cart = new THREE.Group();
  private cartLoad = new THREE.Group();
  private cartQ: (() => void)[] = [];
  private cartBusy = false;
  private foam: THREE.Mesh;
  private pickables: THREE.Object3D[] = [];
  private ptr = new Map<number, { x: number; y: number }>();
  private moved = 0;
  private pinch = 0;
  private seed = 11;
  private off: (() => void)[] = [];
  private paths = new THREE.Group();
  private decor = new THREE.Group();
  private ev: EventiMondo;
  private canvas: HTMLCanvasElement;
  private labelsEl: HTMLElement;
  private hudEl: HTMLElement | null;

  constructor(canvas: HTMLCanvasElement, labelsEl: HTMLElement, hudEl: HTMLElement | null, ev: EventiMondo) {
    this.canvas = canvas; this.labelsEl = labelsEl; this.hudEl = hudEl; this.ev = ev;
    this.reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene.background = new THREE.Color(0x86d4d4);
    this.portrait = innerWidth / innerHeight < 0.8;
    this.target = this.portrait ? new V3(0.6, 0, 0.6) : new V3(-2.6, 0, -2.6);
    this.viewH = Math.min(78, Math.max(30, 32 / (innerWidth / innerHeight)));
    this.resize(); this.placeCam();
    const onResize = () => this.resize();
    addEventListener('resize', onResize); this.off.push(() => removeEventListener('resize', onResize));

    this.scene.add(new THREE.HemisphereLight(0xfff6e2, 0x88b86c, 0.62 * Math.PI));
    const sun = new THREE.DirectionalLight(0xfff0d0, 0.62 * Math.PI);
    sun.position.set(-14, 40, 22); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -34, right: 34, top: 34, bottom: -34, near: 1, far: 120 });
    sun.shadow.camera.updateProjectionMatrix(); sun.shadow.bias = -0.0006;
    this.scene.add(sun);

    this.add(this.scene, new THREE.PlaneGeometry(400, 400), 0x7fd0d2, 0, -1.6, 0, { rx: -Math.PI / 2, cast: false });
    this.foam = this.add(this.scene, new THREE.TorusGeometry(28.8, 0.22, 6, 96), 0xf4fbf8, 0, -1.55, 0, { rx: Math.PI / 2, cast: false });
    this.add(this.scene, new THREE.CylinderGeometry(27.6, 28.6, 1.6, 72), 0xf1dfb0, 0, -1.9, 0, { cast: false });
    const island = new THREE.Mesh(new THREE.CylinderGeometry(25, 26, 2.4, 72), [this.mat(0xd8bf86), this.mat(0x93d26c), this.mat(0xd8bf86)]);
    island.position.y = -1.2; island.receiveShadow = true; this.scene.add(island);
    for (let i = 0; i < 16; i++) {
      const a = this.rnd() * 6.283, r = 6 + this.rnd() * 14;
      this.add(this.scene, new THREE.CircleGeometry(1.2 + this.rnd() * 2, 22), 0x87c962, Math.cos(a) * r, 0.012, Math.sin(a) * r, { rx: -Math.PI / 2, cast: false });
    }
    this.buildWarehouseShell();
    this.whA = this.addLabel('', new V3(WCX, 8.7, WZ0 + 0.25), 'v-lbl v-wh', () => this.ev.onMagazzino());
    this.ginni = this.makeChar(0xee8fab, 0x7a4a2a);
    this.add(this.ginni, new THREE.SphereGeometry(0.22, 12, 10), 0x7a4a2a, 0, 2.05, -0.22);
    this.ginni.position.set(5.2, 0, -5.4); this.ginni.rotation.y = Math.PI / 4; this.ginni.userData.kind = 'ginni'; this.scene.add(this.ginni);
    this.buildCart();
    this.buildFence();
    this.scene.add(this.paths); this.scene.add(this.decor);
    this.bindPointer();
    const loop = (now: number) => { this.raf = requestAnimationFrame(loop); this.frameTick(now); };
    this.raf = requestAnimationFrame(loop);
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.off.forEach((f) => f());
    this.anchors.forEach((a) => a.el.remove());
    this.anchors = [];
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }

  /* ---------- piccoli attrezzi ---------- */
  private MC: Record<number, THREE.MeshLambertMaterial> = {};
  private mat(c: number) { return this.MC[c] || (this.MC[c] = new THREE.MeshLambertMaterial({ color: c })); }
  private rnd() { this.seed = (this.seed * 16807) % 2147483647; return (this.seed - 1) / 2147483646; }
  private add(parent: THREE.Object3D, geo: THREE.BufferGeometry, color: number | THREE.Material, x = 0, y = 0, z = 0, o: { rx?: number; ry?: number; rz?: number; s?: number[]; cast?: boolean } = {}) {
    const m = new THREE.Mesh(geo, typeof color === 'number' ? this.mat(color) : color);
    m.position.set(x, y, z);
    if (o.rx) m.rotation.x = o.rx;
    if (o.ry) m.rotation.y = o.ry;
    if (o.rz) m.rotation.z = o.rz;
    if (o.s) m.scale.set(o.s[0], o.s[1], o.s[2]);
    m.castShadow = o.cast !== false; m.receiveShadow = true;
    parent.add(m);
    return m;
  }
  private tween(dur: number, fn: (p: number) => void, done?: () => void): Tween { const tw: Tween = { t0: performance.now(), dur: Math.max(1, dur), fn, done }; this.tweens.push(tw); return tw; }
  private addLabel(html: string, pos: THREE.Vector3, cls: string, onClick?: () => void): Anchor {
    const el = document.createElement('div');
    el.className = cls; el.innerHTML = html;
    this.labelsEl.appendChild(el);
    const a: Anchor = { el, pos };
    this.anchors.push(a);
    if (onClick) {
      el.setAttribute('role', 'button'); el.tabIndex = 0;
      el.addEventListener('click', onClick);
      el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } });
    }
    return a;
  }
  private dropLabel(a: Anchor) { a.el.remove(); const i = this.anchors.indexOf(a); if (i >= 0) this.anchors.splice(i, 1); }
  private floatText(text: string, pos: THREE.Vector3, cls = '') {
    const el = document.createElement('div');
    el.className = 'v-float ' + cls; el.textContent = text;
    this.labelsEl.appendChild(el);
    const a: Anchor = { el, pos: pos.clone(), free: true };
    this.anchors.push(a);
    setTimeout(() => this.dropLabel(a), 1450);
  }
  private resize() {
    const w = innerWidth, h = innerHeight, a = w / h;
    this.renderer.setSize(w, h, false);
    this.camera.left = -this.viewH * a / 2; this.camera.right = this.viewH * a / 2; this.camera.top = this.viewH / 2; this.camera.bottom = -this.viewH / 2;
    this.camera.updateProjectionMatrix();
  }
  private placeCam() { this.camera.position.copy(this.target).add(OFF); this.camera.lookAt(this.target); }
  private clampTarget() { const r = Math.hypot(this.target.x, this.target.z); if (r > 22) { this.target.x *= 22 / r; this.target.z *= 22 / r; } }

  /* ---------- camera: un solo movimento alla volta ---------- */
  private camTween(toT: THREE.Vector3, toV: number, dur: number) {
    if (this.camTw) this.camTw.dead = true;
    const fromT = this.target.clone(), fromV = this.viewH;
    this.camDest = { t: toT.clone(), v: toV };
    this.camTw = this.tween(this.reduce ? 1 : dur, (p) => {
      const e = easeIO(p);
      this.target.lerpVectors(fromT, toT, e); this.clampTarget(); this.placeCam();
      if (toV !== fromV) { this.viewH = fromV + (toV - fromV) * e; this.resize(); }
    }, () => { this.camTw = null; this.camDest = null; });
  }
  static isWide() { return innerWidth >= 900 && innerWidth >= innerHeight; }
  private frame(x: number, z: number, vh: number, up: number) {
    const to = new V3(x, 0, z);
    if (Mondo.isWide()) to.addScaledVector(RIGHT, 0.17 * vh * innerWidth / innerHeight);
    else to.addScaledVector(AWAY, -up * vh / Math.sin(EL));
    this.camTween(to, vh, 560);
  }
  private remember() { if (!this.savedView) this.savedView = this.camDest ? { t: this.camDest.t.clone(), v: this.camDest.v } : { t: this.target.clone(), v: this.viewH }; }
  ripristina() { this.ctx = null; if (!this.savedView) return; const s = this.savedView; this.savedView = null; this.camTween(s.t, s.v, 520); }
  setCtx(c: Ctx) { this.ctx = c; }
  focusLab(key: string) {
    const L = this.labs.get(key); this.ctx = { type: 'lab', lab: key };
    if (!L) return;
    this.remember();
    const fz = Mondo.isWide() ? 0.45 : -0.45;
    this.frame(L.g.position.x + fz, L.g.position.z + fz, Mondo.isWide() ? 11.5 : 17, 0.22);
  }
  focusMagazzino(model?: Modello) {
    this.ctx = { type: 'wh' }; this.remember();
    const Z = model ? this.zones.get(model) : undefined;
    if (Z) this.frame(Z.x, Z.z, Mondo.isWide() ? 10 : 16, 0.28);
    else this.frame(WCX + 1, WCZ + 1, Mondo.isWide() ? 17 : 34, 0.24);
  }
  focusPila(key: string) {
    const p = this.piles.get(key); this.ctx = null;
    if (!p) return;
    this.frame(p.x, p.z, this.portrait ? 11 : 10, 0.05);
    p.anchor.until = performance.now() + 4500;
  }

  /* ---------- magazzino ---------- */
  private buildWarehouseShell() {
    const WH = this.wh; WH.userData.kind = 'wh'; this.scene.add(WH); this.pickables.push(WH);
    const PINK = 0xf3a7bb, CREAM = 0xfff1dc, GLASS = 0xbfe6f4;
    this.add(WH, box(WW, 0.4, WD), 0xdcb388, WCX, 0.2, WCZ);
    for (let i = 0; i < 9; i++) this.add(WH, box(WW - 0.1, 0.02, 0.06), 0xc79c6f, WCX, 0.41, WZ0 + 0.7 + i * 1.3, { cast: false });
    this.add(WH, box(WW, 4.2, 0.5), PINK, WCX, 2.5, WZ0 + 0.25);
    this.add(WH, box(WW + 0.4, 0.35, 0.7), CREAM, WCX, 4.75, WZ0 + 0.25);
    this.add(WH, box(0.5, 4.2, WD), PINK, WX0 + 0.25, 2.5, WCZ);
    this.add(WH, box(0.7, 0.35, WD + 0.4), CREAM, WX0 + 0.25, 4.75, WCZ);
    const GH = 3.4, GW = WW / 2;
    const gs = new THREE.Shape(); gs.moveTo(-GW, 0); gs.lineTo(GW, 0); gs.lineTo(0, GH); gs.lineTo(-GW, 0);
    this.add(WH, new THREE.ExtrudeGeometry(gs, { depth: 0.5, bevelEnabled: false }), PINK, WCX, 4.6, WZ0);
    const slope = Math.atan2(GH, GW), sl = Math.hypot(GH, GW) + 0.3;
    this.add(WH, box(sl, 0.35, 0.7), CREAM, WCX - GW / 2, 4.6 + GH / 2, WZ0 + 0.25, { rz: slope });
    this.add(WH, box(sl, 0.35, 0.7), CREAM, WCX + GW / 2, 4.6 + GH / 2, WZ0 + 0.25, { rz: -slope });
    for (const x of [WX0 + 3, WX1 - 3]) { this.add(WH, box(1.8, 1.5, 0.12), CREAM, x, 3.1, WZ0 + 0.53); this.add(WH, box(1.4, 1.1, 0.14), GLASS, x, 3.1, WZ0 + 0.54); }
    this.add(WH, box(0.12, 1.5, 1.8), CREAM, WX0 + 0.53, 3.1, WCZ); this.add(WH, box(0.14, 1.1, 1.4), GLASS, WX0 + 0.54, 3.1, WCZ);
    for (const [x, z] of [[WX1 - 0.15, WZ1 - 0.15], [WX0 + 0.15, WZ1 - 0.15], [WX1 - 0.15, WZ0 + 0.15]]) this.add(WH, new THREE.CylinderGeometry(0.22, 0.22, 4.4, 10), CREAM, x, 2.4, z);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(5, 1.25), signMat('AMIMI', '', 0xc4607f));
    sign.position.set(WCX, 5.7, WZ0 + 0.56); WH.add(sign);
    WH.add(this.whInside);
  }
  private disc = new THREE.CircleGeometry(1, 24);
  private DISC = { low: new THREE.MeshLambertMaterial({ color: 0xf2b84b }), neg: new THREE.MeshLambertMaterial({ color: 0xe0574b }), inc: new THREE.MeshLambertMaterial({ color: 0x9fd3ec }) };
  private layoutWarehouse(pile: PilaMondo[]) {
    for (const p of this.piles.values()) this.dropLabel(p.anchor);
    for (const z of this.zones.values()) this.dropLabel(z.anchor);
    this.piles.clear(); this.zones.clear();
    while (this.whInside.children.length) this.whInside.remove(this.whInside.children[0]);
    const byModel = new Map<Modello, PilaMondo[]>();
    for (const p of pile) { const a = byModel.get(p.model) ?? []; a.push(p); byModel.set(p.model, a); }
    // le pile alte dietro; se le file non ci stanno nel fienile, tutto un po' piu' piccolo
    for (let shrink = 1; shrink > 0.5; shrink *= 0.88) {
      let z = WZ0 + 0.9, fits = true;
      const placed: [Modello, PilaMondo[], number, number, number, number, number, number][] = [];
      for (const row of ZROWS) {
        let x = WX0 + 0.75, depth = 0;
        for (const m of row) {
          const ps = (byModel.get(m) ?? []).sort((a, b) => b.stock - a.stock);
          if (!ps.length) continue;
          const P = partsFor(m), sc = PSC(m) * shrink;
          const cw = P.sw * sc + 0.24, cd = Math.max(P.sd * sc + 0.24, 0.5);
          const cols = Math.min(ps.length, MAXCOLS[m] ?? 4), rows = Math.ceil(ps.length / cols);
          const zw = cols * cw + 0.3, zd = rows * cd + 0.3;
          if (x + zw > WX1 - 0.4 && x > WX0 + 0.75) { z += depth + 0.45; x = WX0 + 0.75; depth = 0; }
          placed.push([m, ps, x, z, zw, zd, cw, cd]);
          x += zw + 0.4; depth = Math.max(depth, zd);
        }
        z += depth + 0.45;
      }
      if (z > WZ1 - 0.2) fits = false;
      if (!fits && shrink * 0.88 > 0.5) continue;
      for (const [m, ps, x, z0, zw, zd, cw, cd] of placed) {
        this.add(this.whInside, box(zw, 0.12, zd), 0xd2a06a, x + zw / 2, 0.46, z0 + zd / 2);
        const cols = Math.min(ps.length, MAXCOLS[m] ?? 4);
        ps.forEach((p, i) => {
          const c = i % cols, r = Math.floor(i / cols);
          const g = new THREE.Group(); g.userData = { kind: 'pile', key: p.key };
          const pg: PilaG = { ...p, x: x + 0.15 + (c + 0.5) * cw, z: z0 + 0.15 + (r + 0.5) * cd, cell: Math.min(cw, cd), top: 1, g, anchor: this.addLabel('', new V3(), 'v-lbl v-mini') };
          g.position.set(pg.x, 0.52, pg.z); this.whInside.add(g);
          pg.anchor.cond = (now) => now < (pg.anchor.until ?? 0);
          this.fillPile(pg, shrink);
          this.piles.set(p.key, pg);
        });
        const top = Math.max(...ps.map((p) => this.piles.get(p.key)?.top ?? 1));
        const tot = ps.reduce((s, p) => s + Math.max(0, p.stock), 0);
        const zone: Zona = { x: x + zw / 2, z: z0 + zd / 2, w: zw, d: zd, anchor: this.addLabel(esc(m) + '<small>' + tot + ' pz</small>', new V3(x + zw / 2, top + 0.35, z0 + zd / 2), 'v-lbl v-zone', () => this.ev.onMagazzino(m)) };
        zone.anchor.cond = () => this.viewH < 27 || this.ctx?.type === 'wh';
        this.zones.set(m, zone);
      }
      break;
    }
  }
  private fillPile(p: PilaG, shrink: number) {
    const g = p.g;
    while (g.children.length) g.remove(g.children[0]);
    const P = partsFor(p.model), sc = PSC(p.model) * shrink;
    const st = Math.max(0, p.stock);
    const mk = p.stock < 0 ? 'neg' : st > 0 && st <= 2 ? 'low' : st === 0 && p.incoming > 0 ? 'inc' : null;
    if (mk) { const d = new THREE.Mesh(this.disc, this.DISC[mk]); d.rotation.x = -Math.PI / 2; d.position.y = 0.006; d.scale.setScalar(p.cell * 0.47); d.receiveShadow = true; g.add(d); }
    let top = 0;
    const n = lastre(st);
    if (n) {
      const inst = new THREE.InstancedMesh(P.slabGeo, matsFor(p.look).body, n);
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s3 = new V3(sc, sc, sc), R = rngFor(p.key);
      for (let i = 0; i < n; i++) {
        q.setFromAxisAngle(new V3(0, 1, 0), (R() - 0.5) * 0.2);
        m4.compose(new V3((R() - 0.5) * 0.04, i * P.th * sc, (R() - 0.5) * 0.04), q, s3);
        inst.setMatrixAt(i, m4);
      }
      inst.instanceMatrix.needsUpdate = true; inst.castShadow = true; inst.receiveShadow = true;
      g.add(inst);
      top = n * P.th * sc;
    }
    const b = makeBag(p.model, p.look, { ghost: st === 0 });
    b.scale.setScalar(sc); b.position.y = top; b.rotation.y = 0.5;
    g.add(b);
    p.top = 0.52 + top + P.h * sc;
    p.anchor.el.innerHTML = esc(p.model) + '<small>' + esc(p.name) + ' · ' + (p.stock < 0 ? p.stock + ' pz (negativo)' : st + ' pz') + (p.incoming ? ' · ' + p.incoming + ' in arrivo' : '') + '</small>';
    p.anchor.w = 0;
    p.anchor.pos.set(p.x, p.top + 0.15, p.z);
  }

  /* ---------- laboratori: capannoni di produzione aperti davanti ---------- */
  private makeChar(shirt: number, hair: number) {
    const c = new THREE.Group();
    this.add(c, new THREE.CylinderGeometry(0.09, 0.09, 0.4, 8), 0x4a3a4f, -0.14, 0.2, 0);
    this.add(c, new THREE.CylinderGeometry(0.09, 0.09, 0.4, 8), 0x4a3a4f, 0.14, 0.2, 0);
    this.add(c, new THREE.CylinderGeometry(0.3, 0.42, 0.75, 14), shirt, 0, 0.75, 0);
    this.add(c, new THREE.SphereGeometry(0.44, 18, 14), 0xf7d5bb, 0, 1.48, 0);
    this.add(c, new THREE.SphereGeometry(0.47, 18, 14), hair, 0, 1.66, -0.14, { s: [1, 0.78, 1] });
    this.add(c, new THREE.SphereGeometry(0.055, 8, 6), 0x3a2a20, -0.15, 1.5, 0.41, { cast: false });
    this.add(c, new THREE.SphereGeometry(0.055, 8, 6), 0x3a2a20, 0.15, 1.5, 0.41, { cast: false });
    this.add(c, new THREE.SphereGeometry(0.075, 8, 6), 0xf3a1a1, -0.27, 1.38, 0.33, { cast: false });
    this.add(c, new THREE.SphereGeometry(0.075, 8, 6), 0xf3a1a1, 0.27, 1.38, 0.33, { cast: false });
    const arm = new THREE.Group(); arm.position.set(0.38, 1.0, 0); c.add(arm);
    this.add(arm, box(0.13, 0.45, 0.13), shirt, 0, -0.2, 0);
    this.add(arm, box(0.1, 0.1, 0.36), 0x8a8a96, 0, -0.42, 0.15);
    c.userData.arm = arm;
    return c;
  }
  private wheelGeo = new THREE.CylinderGeometry(0.07, 0.07, 0.05, 10).rotateZ(Math.PI / 2);
  private rollGeo = new THREE.CylinderGeometry(0.16, 0.16, 0.46, 18).rotateZ(Math.PI / 2);
  private spoolGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.12, 12);
  private hideGeo = (() => { const g = new THREE.ExtrudeGeometry(ellShape(1.0, 0.6), { depth: 0.015, bevelEnabled: false }); g.rotateX(-Math.PI / 2); g.translate(0, 0, 0.3); return g; })();
  private FLAG = new THREE.MeshLambertMaterial({ color: 0xe0574b, side: THREE.DoubleSide });
  private flagGeo = (() => { const s = new THREE.Shape(); s.moveTo(0, 0); s.lineTo(0.32, -0.1); s.lineTo(0, -0.2); s.lineTo(0, 0); return new THREE.ShapeGeometry(s); })();
  private buildLab(data: LabMondo, index: number): LabG {
    const [sx, sz] = LAB_SLOTS[index], roof = labColor(index), [shirt, hair] = LAB_SHIRTS[index % LAB_SHIRTS.length];
    const g = new THREE.Group(); g.position.set(sx, 0, sz); g.rotation.y = Math.PI / 4;
    g.userData = { kind: 'lab', key: data.key }; this.scene.add(g); this.pickables.push(g);
    const W = LAB_W, D = LAB_D, wall = plankMat(mix(roof, 0xfff1dc, 0.55));
    this.add(g, box(W, 0.3, D), 0xd9cdb6, 0, 0.15, 0);
    for (let i = 1; i < 6; i++) this.add(g, box(W - 0.1, 0.012, 0.04), 0xc6b89c, 0, 0.305, -D / 2 + i * D / 6, { cast: false });
    this.add(g, box(W - 0.4, 0.015, 0.08), 0xf2c84b, 0, 0.31, -0.75, { cast: false });
    this.add(g, box(W, 3.0, 0.3), wall, 0, 1.8, -D / 2 + 0.15);
    for (const s of [-1, 1]) this.add(g, box(0.3, 1.2, 2.6), wall, s * (W / 2 - 0.15), 0.9, -D / 2 + 1.3);
    this.add(g, box(W + 0.3, 0.1, 0.9), tinMat(roof), 0, 3.25, -D / 2 + 0.6, { rx: 0.35 });
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 0.85), signMat(data.nome.toUpperCase(), data.tipo ? 'laboratorio ' + data.tipo : 'laboratorio', roof));
    sign.position.set(0, 3.95, -D / 2 + 0.2); g.add(sign);
    for (const px of [-1.3, 1.3]) this.add(g, box(0.08, 0.6, 0.08), 0x9a6a3f, px, 3.6, -D / 2 + 0.16);
    this.add(g, box(0.5, 1.3, 0.5), 0xb9805a, W / 2 - 0.8, 3.65, -D / 2 + 0.2);
    this.add(g, box(3.4, 0.14, 1.0), 0xbb8650, -0.3, 0.98, -1.75);
    for (const dx of [-1.55, 1.55]) for (const dz of [-0.4, 0.4]) this.add(g, box(0.12, 0.7, 0.12), 0x9a6a3f, -0.3 + dx, 0.65, -1.75 + dz);
    this.add(g, box(1.2, 0.02, 0.75), 0x4f9a6f, -1.2, 1.06, -1.75, { cast: false });
    const hideSlot = new THREE.Group(); hideSlot.position.set(-1.2, 1.075, -1.75); hideSlot.rotation.y = 0.25; g.add(hideSlot);
    this.add(g, box(0.34, 0.02, 0.05), 0xcfd4da, -0.35, 1.07, -1.5, { ry: 0.45, cast: false });
    this.add(g, box(0.34, 0.02, 0.05), 0xcfd4da, -0.35, 1.075, -1.5, { ry: -0.35, cast: false });
    this.add(g, box(0.7, 0.12, 0.36), 0xeee6d4, 0.6, 1.11, -1.75);
    this.add(g, box(0.14, 0.44, 0.24), 0xd2563f, 0.87, 1.39, -1.75);
    this.add(g, box(0.6, 0.14, 0.22), 0xd2563f, 0.62, 1.58, -1.75);
    this.add(g, box(0.13, 0.24, 0.2), 0xd2563f, 0.35, 1.45, -1.75);
    this.add(g, new THREE.CylinderGeometry(0.008, 0.008, 0.14, 5), 0xcfd4da, 0.35, 1.27, -1.7, { cast: false });
    this.add(g, new THREE.CylinderGeometry(0.09, 0.09, 0.05, 14), 0x3d3a45, 0.96, 1.5, -1.75, { rz: Math.PI / 2 });
    const spoolSlot = new THREE.Group(); spoolSlot.position.set(1.15, 1.11, -1.95); g.add(spoolSlot);
    for (const y of [1.48, 2.18]) this.add(g, box(1.2, 0.06, 0.5), 0xa8743f, 2.3, y, -2.45);
    for (const x of [1.72, 2.88]) this.add(g, box(0.06, 1.5, 0.5), 0x9a6a3f, x, 1.55, -2.45);
    const rollSlot = new THREE.Group(); g.add(rollSlot);
    const ch = this.makeChar(shirt, hair); ch.position.set(-2.45, 0.3, -1.45); g.add(ch);
    const puffs: THREE.Mesh[] = [];
    for (let i = 0; i < 4; i++) {
      const p = new THREE.Mesh(new THREE.SphereGeometry(0.32, 10, 8), new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0 }));
      p.position.set(W / 2 - 0.8, 4.35, -D / 2 + 0.2); g.add(p); puffs.push(p);
    }
    const yard = new THREE.Group(); g.add(yard);
    g.updateMatrixWorld(true);
    const cand = [new V3(-LAB_W / 2 - 1.3, 0, 0.6), new V3(LAB_W / 2 + 1.3, 0, 0.6), new V3(0, 0, -LAB_D / 2 - 1.3)].map((v) => g.localToWorld(v));
    cand.sort((a, b) => a.distanceTo(CART_HOME) - b.distanceTo(CART_HOME));
    const dock = cand[0]; dock.y = 0;
    const anchor = this.addLabel('', new V3(sx, 6.4, sz), 'v-lbl', () => this.ev.onLab(data.key));
    anchor.cond = () => !(this.ctx && (this.ctx.type === 'wh' || this.ctx.type === 'lab'));
    const L: LabG = { g, yard, ch, puffs, hideSlot, rollSlot, spoolSlot, dock, anchor, pileAnchors: [], data, index };
    this.stones(CART_HOME.x, CART_HOME.z, dock.x, dock.z);
    return L;
  }
  private fillYard(L: LabG) {
    const Y = L.yard;
    while (Y.children.length) Y.remove(Y.children[0]);
    L.pileAnchors.forEach((a) => this.dropLabel(a)); L.pileAnchors = [];
    const o = L.data.righe.filter((r) => r.a < r.o).sort((a, b) => (b.o - b.a) - (a.o - a.a));
    o.slice(0, LAB_COLS * 3).forEach((l, i) => {
      const col = i % LAB_COLS, row = Math.floor(i / LAB_COLS);
      const x = (col - (LAB_COLS - 1) / 2) * LAB_CELL, z = row * LAB_ROW;
      const t = new THREE.Group(); t.position.set(x, 0.3, z); Y.add(t);
      this.add(t, box(0.98, 0.06, 0.84), 0x9aa1a8, 0, 0.16, 0);
      for (const [wx, wz] of [[-0.4, -0.34], [0.4, -0.34], [-0.4, 0.34], [0.4, 0.34]]) this.add(t, this.wheelGeo, 0x3d3a45, wx, 0.07, wz, { cast: false });
      for (const hx of [-0.45, 0.45]) this.add(t, box(0.04, 0.62, 0.04), 0x7d848c, hx, 0.48, -0.39);
      this.add(t, box(0.94, 0.04, 0.04), 0x7d848c, 0, 0.78, -0.39);
      const P = partsFor(l.model), sc = PSC(l.model);
      const miss = l.o - l.a, n = Math.max(1, lastre(miss));
      const inst = new THREE.InstancedMesh(P.slabGeo, matsFor(l.look).body, n);
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s3 = new V3(sc, sc, sc), R = rngFor('lab' + l.id);
      for (let k = 0; k < n; k++) {
        q.setFromAxisAngle(new V3(0, 1, 0), (R() - 0.5) * 0.2);
        m4.compose(new V3((R() - 0.5) * 0.04, 0.19 + k * P.th * sc, (R() - 0.5) * 0.04), q, s3);
        inst.setMatrixAt(k, m4);
      }
      inst.instanceMatrix.needsUpdate = true; inst.castShadow = true; inst.receiveShadow = true;
      t.add(inst);
      const top = 0.19 + n * P.th * sc;
      const b = makeBag(l.model, l.look); b.scale.setScalar(sc); b.position.y = top; b.rotation.y = 0.35; t.add(b);
      if (l.late) {
        this.add(t, new THREE.CylinderGeometry(0.015, 0.015, 0.75, 6), 0x5a4a3a, 0.45, 1.15, -0.39);
        const f = new THREE.Mesh(this.flagGeo, this.FLAG); f.position.set(0.46, 1.5, -0.39); t.add(f);
      }
      const wp = L.g.localToWorld(new V3(x, 0.3 + top + P.h * sc + 0.12, z));
      const a = this.addLabel('<b>' + miss + '</b> pz', wp, 'v-lbl v-mini v-yard');
      a.el.title = l.model + ' ' + l.label;
      a.cond = (now) => (this.ctx?.type === 'lab' && this.ctx.lab === L.data.key) || now < (a.until ?? 0);
      L.pileAnchors.push(a);
    });
    for (const slot of [L.hideSlot, L.rollSlot, L.spoolSlot]) while (slot.children.length) slot.remove(slot.children[0]);
    if (o[0]) { const h = new THREE.Mesh(this.hideGeo, matsFor(o[0].look).body); h.receiveShadow = true; L.hideSlot.add(h); }
    const looks: Look[] = [];
    o.forEach((l) => { if (!looks.some((k) => k.key === l.look.key)) looks.push(l.look); });
    const RP = [[2.0, 1.67], [2.6, 1.67], [2.0, 2.37], [2.6, 2.37]];
    looks.slice(0, 4).forEach((lk, i) => { const r = new THREE.Mesh(this.rollGeo, matsFor(lk).body); r.position.set(RP[i][0], RP[i][1], -2.45); r.castShadow = true; L.rollSlot.add(r); });
    looks.slice(0, 3).forEach((lk, i) => { this.add(L.spoolSlot, this.spoolGeo, lk.cols[0], 0, 0, i * 0.18); });
    const pz = o.reduce((s, l) => s + l.o - l.a, 0);
    const late = o.filter((l) => l.late).length;
    L.anchor.el.innerHTML = '<b>' + esc(L.data.nome) + '</b><small>' + (o.length ? pz + ' pz in preparazione' : 'tutto arrivato') + '</small>' + (late ? '<span class="v-bang" title="' + late + ' righe in ritardo">!</span>' : '');
    L.anchor.w = 0;
  }

  /* ---------- furgoncino, staccionata, alberi, sentieri ---------- */
  private buildCart() {
    const cart = this.cart, GLASS = 0xbfe6f4;
    cart.userData.kind = 'cart'; this.scene.add(cart); this.pickables.push(cart);
    this.add(cart, box(1.7, 0.45, 1.15), 0xf6c344, -0.2, 0.7, 0);
    this.add(cart, box(0.9, 0.85, 1.1), 0xf6c344, 1.0, 0.9, 0);
    this.add(cart, box(0.08, 0.4, 0.9), GLASS, 1.46, 1.05, 0);
    this.add(cart, box(1.75, 0.08, 1.2), 0xe0a92f, -0.2, 0.95, 0, { cast: false });
    const wg = new THREE.CylinderGeometry(0.28, 0.28, 0.2, 14);
    for (const [x, z] of [[-0.6, 0.6], [-0.6, -0.6], [0.9, 0.6], [0.9, -0.6]]) this.add(cart, wg, 0x3d3a45, x, 0.28, z, { rx: Math.PI / 2 });
    this.cartLoad.position.set(-0.2, 0.99, 0); cart.add(this.cartLoad);
    cart.position.copy(CART_HOME); cart.rotation.y = -Math.PI / 2;
  }
  private buildFence() {
    const fp: [number, number][] = [];
    for (let d = 168; d <= 282; d += 4.2) { const a = d * Math.PI / 180; fp.push([Math.cos(a) * 21.8, Math.sin(a) * 21.8]); }
    const postGeo = box(0.22, 1.0, 0.22);
    fp.forEach(([x, z], i) => {
      this.add(this.scene, postGeo, 0xfff4e0, x, 0.5, z);
      if (i > 0) {
        const [px, pz] = fp[i - 1]; const dx = x - px, dz = z - pz; const len = Math.hypot(dx, dz);
        for (const y of [0.42, 0.78]) this.add(this.scene, box(len, 0.1, 0.08), 0xfff4e0, (x + px) / 2, y, (z + pz) / 2, { ry: Math.atan2(-dz, dx) });
      }
    });
  }
  private stoneGeo = new THREE.CylinderGeometry(0.42, 0.48, 0.12, 9);
  private stones(ax: number, az: number, bx: number, bz: number) {
    const n = Math.floor(Math.hypot(bx - ax, bz - az) / 1.15);
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      this.add(this.paths, this.stoneGeo, 0xeee2c2, ax + (bx - ax) * t + (this.rnd() - 0.5) * 0.25, 0.06, az + (bz - az) * t + (this.rnd() - 0.5) * 0.25, { cast: false, ry: this.rnd() * 3 });
    }
  }
  private buildDecor(used: [number, number][]) {
    const D = this.decor;
    while (D.children.length) D.remove(D.children[0]);
    const free = (x: number, z: number, r: number) => used.every(([ux, uz]) => Math.hypot(ux - x, uz - z) > r);
    const tree = (x: number, z: number, col: number, sc: number) => {
      if (!free(x, z, 6.2)) return;
      const g = new THREE.Group(); g.position.set(x, 0, z); g.scale.setScalar(sc); D.add(g);
      this.add(g, new THREE.CylinderGeometry(0.28, 0.4, 1.7, 9), 0x9a6a43, 0, 0.85, 0);
      const c2 = new THREE.Color(col).multiplyScalar(0.88).getHex();
      this.add(g, new THREE.SphereGeometry(1.4, 16, 12), col, 0, 2.5, 0);
      this.add(g, new THREE.SphereGeometry(1.0, 14, 10), c2, 0.85, 2.1, 0.3);
      this.add(g, new THREE.SphereGeometry(1.0, 14, 10), c2, -0.75, 2.15, -0.25);
      this.add(g, new THREE.SphereGeometry(0.9, 14, 10), col, 0.1, 3.3, 0.1);
    };
    const bush = (x: number, z: number, s: number) => {
      if (!free(x, z, 5.2)) return;
      const g = new THREE.Group(); g.position.set(x, 0, z); g.scale.setScalar(s); D.add(g);
      this.add(g, new THREE.SphereGeometry(0.9, 12, 10), 0x6db54a, 0, 0.55, 0);
      this.add(g, new THREE.SphereGeometry(0.7, 12, 10), 0x7cc456, 0.8, 0.45, 0.2);
      this.add(g, new THREE.SphereGeometry(0.65, 12, 10), 0x63a843, -0.7, 0.42, 0.1);
      const FL = [0xf27a8c, 0xf6d04d, 0xffffff, 0xb08ae0];
      for (let i = 0; i < 5; i++) this.add(g, new THREE.SphereGeometry(0.14, 8, 6), FL[i % 4], (this.rnd() - 0.5) * 1.6, 0.9 + this.rnd() * 0.4, (this.rnd() - 0.5) * 1.0, { cast: false });
    };
    const GREEN = 0x76c04f, BLOSSOM = 0xf5a9c5, AUTUMN = 0xf0a24b;
    ([[-19, -8.5, GREEN, 1.05], [-12, -16.5, BLOSSOM, 1], [-4, -15.8, GREEN, 1.15], [5.5, -15, BLOSSOM, 0.95], [10, -16, GREEN, 1], [15, -12.5, GREEN, 1.05],
      [18, -4, AUTUMN, 1], [-19, -2, GREEN, 1.05], [-17, 4.5, BLOSSOM, 1], [-13.5, 3.4, AUTUMN, 0.85], [19, 2.5, GREEN, 0.9]] as [number, number, number, number][]).forEach((t) => tree(t[0], t[1], t[2], t[3]));
    ([[14, 12], [7.5, 17], [-2, 17.5], [-12, 14.5], [17.5, 8.5], [-16, 10], [0.5, 5.2], [-9.5, 3.5]] as [number, number][]).forEach((b) => bush(b[0], b[1], 0.9 + this.rnd() * 0.3));
  }

  /* ---------- dati: si ricostruiscono magazzino e laboratori ---------- */
  aggiorna(dati: DatiMondo) {
    this.layoutWarehouse(dati.pile);
    const keys = dati.labs.slice(0, LAB_SLOTS.length).map((l) => l.key);
    const same = keys.length === this.labs.size && keys.every((k, i) => this.labs.get(k)?.index === i);
    if (!same) {
      for (const L of this.labs.values()) { this.scene.remove(L.g); this.dropLabel(L.anchor); L.pileAnchors.forEach((a) => this.dropLabel(a)); const pi = this.pickables.indexOf(L.g); if (pi >= 0) this.pickables.splice(pi, 1); }
      this.labs.clear();
      while (this.paths.children.length) this.paths.remove(this.paths.children[0]);
      dati.labs.slice(0, LAB_SLOTS.length).forEach((d, i) => this.labs.set(d.key, this.buildLab(d, i)));
      this.buildDecor(keys.map((_, i) => LAB_SLOTS[i]));
    }
    dati.labs.slice(0, LAB_SLOTS.length).forEach((d) => { const L = this.labs.get(d.key); if (L) { L.data = d; this.fillYard(L); } });
    this.whA.el.innerHTML = 'Magazzino<small>' + dati.totale + ' pezzi</small>'; this.whA.w = 0;
  }
  /** Il furgoncino va dal laboratorio al magazzino con `n` pezzi della variante; alla fine la pila fa un saltello. */
  arrivo(labKey: string, riga: RigaMondo, n: number, pilaKey: string) {
    const go = () => {
      const L = this.labs.get(labKey);
      if (!L) { this.cartBusy = false; this.next(); return; }
      this.cartBusy = true;
      this.drive(L.dock, () => {
        while (this.cartLoad.children.length) this.cartLoad.remove(this.cartLoad.children[0]);
        const k = Math.min(4, Math.max(1, Math.round(n / 8))), P = partsFor(riga.model), s = Math.min(0.75, 0.75 / P.w);
        for (let i = 0; i < k; i++) { const b = makeBag(riga.model, riga.look); b.scale.setScalar(s); b.position.set(i % 2 ? 0.38 : -0.38, 0, i < 2 ? -0.22 : 0.22); b.rotation.y = Math.PI / 2; this.cartLoad.add(b); }
        setTimeout(() => this.drive(CART_HOME, () => {
          while (this.cartLoad.children.length) this.cartLoad.remove(this.cartLoad.children[0]);
          const p = this.piles.get(pilaKey);
          if (p) {
            this.tween(this.reduce ? 1 : 560, (t) => { p.g.scale.set(1, 0.55 + 0.45 * back(t), 1); });
            this.floatText('+' + n, new V3(p.x, p.top + 0.9, p.z));
            p.anchor.until = performance.now() + 3500;
          }
          this.cart.rotation.y = -Math.PI / 2;
          setTimeout(() => { this.cartBusy = false; this.next(); }, 350);
        }), 350);
      });
    };
    this.cartQ.push(go);
    if (!this.cartBusy) this.next();
  }
  private next() { const f = this.cartQ.shift(); if (f) f(); }
  private drive(to: THREE.Vector3, done: () => void) {
    const from = this.cart.position.clone(); from.y = 0;
    const dx = to.x - from.x, dz = to.z - from.z, dist = Math.hypot(dx, dz);
    if (dist < 0.05) { done(); return; }
    this.cart.rotation.y = Math.atan2(-dz, dx);
    this.tween(this.reduce ? 1 : Math.min(1700, Math.max(700, dist * 85)), (p) => {
      this.cart.position.lerpVectors(from, to, easeIO(p));
      this.cart.position.y = this.reduce ? 0 : Math.abs(Math.sin(p * Math.PI * 9)) * 0.05;
    }, () => { this.cart.position.y = 0; done(); });
  }
  /** Mostra l'etichetta della pila per qualche secondo (tocco su una pila). */
  mostraPila(key: string) { const p = this.piles.get(key); if (p) p.anchor.until = performance.now() + 3500; }

  /* ---------- tocchi: trascina, pizzica, tocca ---------- */
  private bindPointer() {
    const c = this.canvas;
    const down = (e: PointerEvent) => { c.setPointerCapture(e.pointerId); this.ptr.set(e.pointerId, { x: e.clientX, y: e.clientY }); if (this.ptr.size === 1) this.moved = 0; else this.pinch = 0; };
    const move = (e: PointerEvent) => {
      const p = this.ptr.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      if (this.ptr.size === 1) { this.moved += Math.abs(dx) + Math.abs(dy); if (this.moved > 6) this.pan(dx, dy); }
      else if (this.ptr.size === 2) {
        const [a, b] = [...this.ptr.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (this.pinch) this.zoomBy(this.pinch / d);
        this.pinch = d; this.moved = 99;
      }
    };
    const end = (e: PointerEvent) => {
      if (!this.ptr.has(e.pointerId)) return;
      this.ptr.delete(e.pointerId);
      if (this.ptr.size < 2) this.pinch = 0;
      if (this.ptr.size === 0 && this.moved <= 6 && e.type === 'pointerup') this.pick(e.clientX, e.clientY);
    };
    const wheel = (e: WheelEvent) => { e.preventDefault(); this.zoomBy(e.deltaY > 0 ? 1.1 : 1 / 1.1); };
    c.addEventListener('pointerdown', down); c.addEventListener('pointermove', move); c.addEventListener('pointerup', end); c.addEventListener('pointercancel', end);
    c.addEventListener('wheel', wheel, { passive: false });
    this.off.push(() => { c.removeEventListener('pointerdown', down); c.removeEventListener('pointermove', move); c.removeEventListener('pointerup', end); c.removeEventListener('pointercancel', end); c.removeEventListener('wheel', wheel); });
  }
  /** Tocco sul canvas. Restituisce false se non ha preso niente (la pagina lo usa per chiudere il pannello). */
  onTap: ((hit: boolean) => void) | null = null;
  private pick(x: number, y: number) {
    const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(x / innerWidth * 2 - 1, -(y / innerHeight) * 2 + 1);
    ray.setFromCamera(ndc, this.camera);
    if (this.ctx) { this.onTap?.(false); return; }
    for (const h of ray.intersectObjects([...this.pickables, this.ginni], true)) {
      let o: THREE.Object3D | null = h.object;
      while (o && !o.userData.kind) o = o.parent;
      if (!o) continue;
      const k = o.userData.kind;
      if (k === 'lab') { this.ev.onLab(o.userData.key); return; }
      if (k === 'pile') { this.mostraPila(o.userData.key); return; }
      if (k === 'wh') { this.ev.onMagazzino(); return; }
      if (k === 'ginni') { this.ev.onGinni(); return; }
      if (k === 'cart') { this.ev.onCarro(); return; }
    }
    this.onTap?.(false);
  }
  private pan(dx: number, dy: number) {
    const wpp = this.viewH / innerHeight;
    this.target.addScaledVector(RIGHT, -dx * wpp);
    this.target.addScaledVector(AWAY, dy * wpp / Math.sin(EL));
    this.clampTarget(); this.placeCam();
  }
  private zoomBy(f: number) { this.viewH = Math.min(80, Math.max(8, this.viewH * f)); this.resize(); }

  /* ---------- ciclo ---------- */
  private v3 = new V3();
  private frameTick(now: number) {
    for (let i = this.tweens.length - 1; i >= 0; i--) {
      const tw = this.tweens[i];
      if (tw.dead) { this.tweens.splice(i, 1); continue; }
      const p = Math.min(1, (now - tw.t0) / tw.dur);
      tw.fn(p);
      if (p >= 1) { this.tweens.splice(i, 1); tw.done?.(); }
    }
    const t = now / 1000;
    if (!this.reduce) {
      this.ginni.position.y = Math.abs(Math.sin(t * 2.2)) * 0.06;
      this.foam.scale.setScalar(1 + Math.sin(t * 0.8) * 0.004);
      for (const L of this.labs.values()) {
        const busy = L.data.righe.some((r) => r.a < r.o);
        L.puffs.forEach((pf, i) => {
          const ph = (t * 0.35 + i / 4) % 1;
          pf.position.y = 4.35 + ph * 2.4;
          pf.position.x = LAB_W / 2 - 0.8 + Math.sin(ph * 4 + i) * 0.15;
          const s = 0.35 + ph * 0.75; pf.scale.set(s, s, s);
          (pf.material as THREE.MeshLambertMaterial).opacity = busy ? 0.8 * (1 - ph) * Math.min(1, ph * 5) : 0;
        });
        (L.ch.userData.arm as THREE.Group).rotation.x = busy ? -0.4 + Math.sin(t * 7 + L.index) * 0.55 : 0;
      }
    }
    this.updateLabels(now);
    this.renderer.render(this.scene, this.camera);
  }
  private updateLabels(now: number) {
    const w = innerWidth, h = innerHeight;
    const hudB = this.portrait && this.hudEl ? this.hudEl.offsetHeight + 4 : 0;
    for (const a of this.anchors) {
      let show = !!(a.cond ? a.cond(now) : true);
      if (show) {
        this.v3.copy(a.pos).project(this.camera);
        if (!a.free && (this.v3.x < -1.05 || this.v3.x > 1.05 || this.v3.y < -1.05 || this.v3.y > 1.02 || (1 - this.v3.y) / 2 * h < hudB + 30)) show = false;
      }
      if (a.el.hidden === show) a.el.hidden = !show;
      if (!show) continue;
      let x = (this.v3.x + 1) / 2 * w;
      if (!a.free) {
        if (!a.w) a.w = a.el.offsetWidth;
        const half = a.w / 2 + 8;
        x = Math.max(half, Math.min(w - half, x));
      }
      a.el.style.transform = 'translate(' + x.toFixed(1) + 'px,' + ((1 - this.v3.y) / 2 * h).toFixed(1) + 'px) translate(-50%,-100%)';
    }
  }
}

