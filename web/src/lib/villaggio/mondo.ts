// Villaggio (16-10): il mondo three.js, un'isola in vista 3/4 con il magazzino (una pedana per modello, una pila per
// variante) e i laboratori (capannoni con un carrello per variante in lavorazione). Riceve dati gia' pronti dalla pagina
// e non scrive niente: le scritture passano dai componenti di Ordini (ArrivoRow, SupplierOrderForm) montati nella pagina.
// Scala unica: una lastra della pila = 2 pezzi, in magazzino (quello che c'e') e sui carrelli (quello che deve arrivare).
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { lastre, parseLook } from './catalogo';
import type { Look, Modello } from './catalogo';
import type { Ambiente, Meteo, Momento, Stagione } from './meteo';

export type RigaMondo = { id: string; codice: string; model: Modello; look: Look; label: string; a: number; o: number; late: boolean; wip?: boolean };
/** `pz` = pezzi in arrivo del laboratorio come li conta la pagina (WIP escluse, prodotti non disegnabili inclusi): l'etichetta 3D dice lo stesso numero del pannello. */
export type LabMondo = { key: string; nome: string; tipo: string; righe: RigaMondo[]; pz: number };
/** `neg` = almeno un codice della pila ha giacenza negativa (anche se la somma della pila e' positiva). */
export type PilaMondo = { key: string; model: Modello; look: Look; name: string; stock: number; incoming: number; neg?: boolean };
export type DatiMondo = { labs: LabMondo[]; pile: PilaMondo[]; totale: number };
/** Il fumetto sopra l'artigiano (fase 3): righe senza data, righe oltre la data, verificato da poco. Dice com'e' messa
 *  l'informazione, non giudica il laboratorio: niente facce. */
export type Fumetto = 'domanda' | 'orologio' | 'cuore';
/** `onPila`: tocco su una pila (o sulla sua bandierina) del magazzino; `onFumetto`: tocco sul fumetto di un capannone. */
export type EventiMondo = { onLab: (key: string) => void; onMagazzino: (model?: Modello) => void; onGinni: () => void; onCarro: () => void; onPartenza?: (n: number) => void;
  onPila?: (key: string) => void; onFumetto?: (labKey: string) => void };
type Ctx = { type: string; lab?: string } | null;
type Anchor = { el: HTMLElement; pos: THREE.Vector3; cond?: (now: number) => boolean; free?: boolean; w?: number; h?: number; until?: number };
type Tween = { t0: number; dur: number; fn: (p: number) => void; done?: () => void; dead?: boolean; ombre?: boolean };
/** Dopo questo tempo senza tocchi ne' dati nuovi l'isola si ferma (fumo, braccia, Ginni) e non ridisegna piu': batteria. */
const RIPOSO_MS = 20000;

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
/** Geometrie, materiali e texture delle cache di modulo: chi svuota un gruppo non li libera (li libera liberaCache all'ultimo Mondo). */
const SHARED = new WeakSet<object>();
const CANV: Record<string, HTMLCanvasElement> = {};
const TEX: Record<string, THREE.CanvasTexture> = {};
type Mats = { body: THREE.Material; strap: THREE.Material; gold: THREE.Material; silver: THREE.Material; dark: THREE.Material };
const MATS: Record<string, Mats> = {};
export const canvasFor = (look: Look) => CANV[look.key] || (CANV[look.key] = paint(look));
const SWU: Record<string, string> = {};
/** dataURL della texture (legenda): calcolato una volta sola, non a ogni render. */
export const swatchURL = (look: Look) => SWU[look.key] || (SWU[look.key] = canvasFor(look).toDataURL());
function texFor(look: Look) {
  if (TEX[look.key]) return TEX[look.key];
  const t = new THREE.CanvasTexture(canvasFor(look));
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  const r = REP[look.fin] ?? 1.2;
  t.repeat.set(r, r);
  SHARED.add(t);
  return TEX[look.key] = t;
}
const GOLD = new THREE.MeshPhongMaterial({ color: 0xd9b45a, shininess: 90, specular: 0xffffff });
const SILVER = new THREE.MeshPhongMaterial({ color: 0xd3d8de, shininess: 90, specular: 0xffffff });
const DARK = new THREE.MeshLambertMaterial({ color: 0x2a2626 });
SHARED.add(GOLD); SHARED.add(SILVER); SHARED.add(DARK);
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
  for (const m of Object.values(M)) SHARED.add(m);
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
  for (const x of [...d.parts.map((p) => p[0]), ...pierce, ...charm, sg]) SHARED.add(x);
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
/** il secondo contesto WebGL non si e' creato: niente miniature (resta il riquadro vuoto), il resto va avanti */
let THKO = false;
export function thumb(model: Modello, look: Look): string {
  const k = model + '|' + look.key;
  if (THC[k]) return THC[k];
  if (THKO) return '';
  if (!TR) {
    try { TR = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true }); }
    catch { THKO = true; return ''; }
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
let VIVI = 0;
/** Libera cio' che le cache di modulo tengono in GPU (materiali, texture, geometrie, renderer delle miniature). Gli URL restano. */
function liberaCache() {
  const mats = new Set<THREE.Material>();
  for (const k of Object.keys(MATS)) { for (const m of Object.values(MATS[k])) mats.add(m); delete MATS[k]; }
  mats.add(GOLD); mats.add(SILVER); mats.add(DARK);
  mats.forEach((m) => m.dispose());
  for (const k of Object.keys(TEX)) { TEX[k].dispose(); delete TEX[k]; }
  for (const k of Object.keys(GEO) as Modello[]) { const g = GEO[k] as Geo; for (const x of [...g.parts.map((p) => p[0]), ...g.pierce, ...g.charm, g.slabGeo]) x.dispose(); delete GEO[k]; }
  if (TR) { TR.dispose(); TR.forceContextLoss(); }
  TR = null; TS = null; TC = null;
  THQ.length = 0;
  for (const k of Object.keys(CANV)) delete CANV[k];
}
/** Miniature in coda: al massimo ~12 ms per frame, cosi' un pannello con 80 borse non blocca la pagina. */
const THQ: [Modello, Look, (u: string) => void][] = [];
let thBusy = false;
/** Restituisce la funzione che toglie la richiesta dalla coda (il componente si smonta prima che tocchi a lui). */
export function thumbAsync(model: Modello, look: Look, cb: (u: string) => void): () => void {
  const k = model + '|' + look.key;
  if (THC[k]) { cb(THC[k]); return () => {}; }
  const job: [Modello, Look, (u: string) => void] = [model, look, cb];
  THQ.push(job);
  if (!thBusy) {
    thBusy = true;
    const step = () => {
      // senza un Mondo vivo le cache sono gia' state liberate: disegnare ora ricreerebbe un contesto WebGL orfano
      if (!VIVI) { THQ.length = 0; thBusy = false; return; }
      const t0 = performance.now();
      while (THQ.length && performance.now() - t0 < 12) {
        const [m, l, c] = THQ.shift() as [Modello, Look, (u: string) => void];
        let u = '';
        try { u = thumb(m, l); } catch { THKO = true; }
        c(u);
      }
      if (THQ.length) requestAnimationFrame(step); else thBusy = false;
    };
    requestAnimationFrame(step);
  }
  return () => { const i = THQ.indexOf(job); if (i >= 0) THQ.splice(i, 1); };
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
/** Righe a due colori (tenda del chiosco, spicchi della mongolfiera): `rep` coppie di righe lungo la u. */
function righeMat(a: number, b: number, rep: number) {
  const cv = document.createElement('canvas'); cv.width = 64; cv.height = 8;
  const x = cv.getContext('2d') as CanvasRenderingContext2D;
  x.fillStyle = hex(a); x.fillRect(0, 0, 32, 8); x.fillStyle = hex(b); x.fillRect(32, 0, 32, 8);
  const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep, 1);
  return new THREE.MeshLambertMaterial({ map: t });
}

/** Macchia di luce calda, piena al centro e sfumata ai bordi: l'alone dei lampioni accesi. */
function alone() {
  const cv = document.createElement('canvas'); cv.width = cv.height = 64;
  const x = cv.getContext('2d') as CanvasRenderingContext2D;
  const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,0.85)'); gr.addColorStop(0.45, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(cv);
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
const GINNI = new V3(5.2, 0, -5.4);
/* premi delle Paillettes (fase 2), lontani dai posti dei capannoni e da tutti i sentieri possibili: la piazzetta davanti al
   magazzino, fra il sentiero del primo laboratorio e quello lungo il magazzino; il tappeto da Ginni al lato aperto del
   magazzino; la mongolfiera in cielo dietro a destra, dove sullo schermo non copre capannoni ne' pile */
const FONTANA = new V3(-6.3, 0, 2.5);
const CHIOSCO = new V3(-2.2, 0, 1.2);
const PANCHINA = new V3(-8.9, 0, 0.85);
const LAMPIONI: [number, number][] = [[-8.0, 0.25], [-5.0, 0.9], [-0.6, 0.0]];
const PALLONE = new V3(4, 13, -11.6);
const TAPPETO = { x0: WX1 + 0.05, x1: GINNI.x + 0.8 };
/** Ingombri a terra (x, z, raggio) dei premi a posto fisso, anche di quelli non ancora sbloccati: le aiuole li evitano
 *  e non si spostano quando arriva il premio del livello dopo. */
const INGOMBRI: [number, number, number][] = [[FONTANA.x, FONTANA.z, 1.7], [CHIOSCO.x, CHIOSCO.z, 1.4], [PANCHINA.x, PANCHINA.z, 1.0],
  ...LAMPIONI.map(([x, z]): [number, number, number] => [x, z, 0.7]), [GINNI.x, GINNI.z, 1.0],
  ...[0, 1, 2, 3].map((i): [number, number, number] => [TAPPETO.x0 + 0.5 + i * (TAPPETO.x1 - TAPPETO.x0 - 1) / 3, GINNI.z, 0.9])];
/* ambiente (fase 3). Luce: cielo, emisfero [cielo, terra, intensita'], sole [colore, intensita'], direzione del sole.
   Sono colori lineari come il resto (ColorManagement spento), tarati sugli screenshot delle 4 ore. */
type Luce = { cielo: number; emi: [number, number, number]; sole: [number, number]; dir: [number, number, number]; nebbia: number };
const LUCI: Record<Momento, Luce> = {
  mattina: { cielo: 0x9fd8d0, emi: [0xffedd6, 0x8fa86c, 0.6], sole: [0xffd6a0, 0.66], dir: [-34, 26, 6], nebbia: 0xeee6d8 },
  giorno: { cielo: 0x86d4d4, emi: [0xfff6e2, 0x88b86c, 0.62], sole: [0xfff0d0, 0.62], dir: [-14, 40, 22], nebbia: 0xe1e8e7 },
  tramonto: { cielo: 0xe6b2ae, emi: [0xffd8d4, 0x8c7c96, 0.52], sole: [0xffa47e, 0.72], dir: [34, 20, 10], nebbia: 0xecd3d0 },
  sera: { cielo: 0x2c4a74, emi: [0x9ab2e6, 0x34405e, 0.5], sole: [0xa9bcff, 0.22], dir: [-18, 40, 12], nebbia: 0x3a4866 },
};
/** Il meteo spegne un po' il sole, alza la luce diffusa e ingrigisce i colori (`grigio` = quanto verso il grigio). */
const METEO_LUCE: Record<Meteo, { sole: number; emi: number; grigio: number }> = {
  sereno: { sole: 1, emi: 1, grigio: 0 }, nuvole: { sole: 0.55, emi: 1.04, grigio: 0.22 }, pioggia: { sole: 0.3, emi: 0.86, grigio: 0.45 },
  neve: { sole: 0.5, emi: 1.1, grigio: 0.3 }, nebbia: { sole: 0.45, emi: 1.04, grigio: 0.32 },
};
/** Le vesti delle stagioni: prato, chiazze d'erba (d'inverno neve), chiome per tipo d'albero [chioma, cima] (0 = tondo,
 *  1 = fiorito, 2 = acero), cespugli, foglie a terra. */
type Veste = { prato: number; chiazze: number; chiome: [number, number][]; cespugli: [number, number, number]; foglie: boolean };
const VESTI: Record<Stagione, Veste> = {
  primavera: { prato: 0x96d46a, chiazze: 0x8acd5f, chiome: [[0x86cf55, 0x86cf55], [0xf5a9c5, 0xf8bfd4], [0xfadbe6, 0xfde8ef]], cespugli: [0x78c84e, 0x88d65c, 0x6cbc46], foglie: false },
  estate: { prato: 0x93d26c, chiazze: 0x87c962, chiome: [[0x76c04f, 0x76c04f], [0x6bb848, 0x6bb848], [0x5fae42, 0x5fae42]], cespugli: [0x6db54a, 0x7cc456, 0x63a843], foglie: false },
  autunno: { prato: 0xa2c866, chiazze: 0x96bd5a, chiome: [[0xf0a24b, 0xf4b45e], [0xc9653f, 0xd2774c], [0xe9b949, 0xf0c95e]], cespugli: [0x98ad48, 0xb5a646, 0x8a9c40], foglie: true },
  inverno: { prato: 0xa9c09c, chiazze: 0xeef3f3, chiome: [[0xd9e5e2, 0xf7fafb], [0x4f8a5c, 0xf4f8f9], [0xcfdcda, 0xf7fafb]], cespugli: [0x6f9070, 0xe6eef0, 0x67866a], foglie: false },
};
const FOGLIE = [0xe9973a, 0xc9653f, 0xe6b33f, 0xd9822f];
/** Icone dei fumetti, disegnate a mano (niente emoji: ogni telefono le disegna a modo suo). */
const ICONA: Record<Fumetto, string> = {
  domanda: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.9 9.1a3.1 3.1 0 1 1 4.4 2.8c-.9.5-1.3 1.1-1.3 2.1v.6" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="18.7" r="1.75" fill="currentColor"/></svg>',
  orologio: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.6" fill="none" stroke="currentColor" stroke-width="2.6"/><path d="M12 7.4V12l3.2 2.2" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  cuore: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.4c-.4 0-7.9-4.7-7.9-10.3A4.4 4.4 0 0 1 12 7.5a4.4 4.4 0 0 1 7.9 2.6c0 5.6-7.5 10.3-7.9 10.3z" fill="currentColor"/></svg>',
};
const DETTO: Record<Fumetto, (nome: string) => string> = {
  domanda: (n) => n + ': ci sono righe senza data di consegna. Tocca per la verifica',
  orologio: (n) => n + ': ci sono righe oltre la data di consegna. Tocca per la verifica',
  cuore: (n) => n + ': verificato da poco',
};
/** `k` e' una chiave propria di `o` (non 'constructor' o simili ereditati): i valori arrivano dalla pagina. */
const di = <T extends object>(o: T, k: unknown): k is keyof T => typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k);
const distSeg = (x: number, z: number, a: THREE.Vector3, b: THREE.Vector3) => {
  const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz;
  const t = l2 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / l2)) : 0;
  return Math.hypot(x - a.x - dx * t, z - a.z - dz * t);
};

type LabG = { g: THREE.Group; yard: THREE.Group; ch: THREE.Group; puffs: THREE.Mesh[]; hideSlot: THREE.Group; rollSlot: THREE.Group; spoolSlot: THREE.Group; dock: THREE.Vector3; anchor: Anchor; pileAnchors: Anchor[]; testo: string; html: string; data: LabMondo; index: number };
type PilaG = PilaMondo & { x: number; z: number; cell: number; top: number; g: THREE.Group; anchor: Anchor };
type Zona = { x: number; z: number; w: number; d: number; anchor: Anchor };

export class Mondo {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 400);
  // assegnati in allestisci(), chiamato dal costruttore
  private target!: THREE.Vector3;
  private viewH!: number;
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
  private whA!: Anchor;
  private labs = new Map<string, LabG>();
  private piles = new Map<string, PilaG>();
  private zones = new Map<Modello, Zona>();
  private ginni!: THREE.Group;
  private cart = new THREE.Group();
  private cartLoad = new THREE.Group();
  private cartQ: (() => void)[] = [];
  private cartBusy = false;
  private foam!: THREE.Mesh;
  private pickables: THREE.Object3D[] = [];
  private ptr = new Map<number, { x: number; y: number }>();
  private moved = 0;
  private pinch = 0;
  private seed = 11;
  private off: (() => void)[] = [];
  private paths = new THREE.Group();
  private decor = new THREE.Group();
  /** alberi e cespugli messi da buildDecor (x, z, raggio): le aiuole dei premi non ci finiscono sopra */
  private occupati: [number, number, number][] = [];
  /** decorazioni sbloccate dai livelli delle Paillettes; la corona sta su Ginni, la mongolfiera ondeggia da sveglia */
  private premi = new THREE.Group();
  private corona = new THREE.Group();
  private pallone: THREE.Group | null = null;
  private livello = 0;
  private ev: EventiMondo;
  private canvas: HTMLCanvasElement;
  private labelsEl: HTMLElement;
  private hudEl: HTMLElement | null;
  /** risorse di questo Mondo riusate fra un aggiorna() e l'altro: svuotando un gruppo non si liberano */
  private keep = new WeakSet<object>();
  private shadowDirty = true;
  private dirty = true;
  private lastRender = 0;
  private lastLabels = 0;
  private ultimoInput = performance.now();
  /** gia' in posa di riposo */
  private fermo = false;
  /* ambiente (fase 3): luci e materiali che cambiano colore con l'ora e la stagione, senza ricostruire niente */
  private amb: Ambiente = { stagione: 'estate', momento: 'giorno', meteo: 'sereno' };
  private hemi!: THREE.HemisphereLight;
  private sun!: THREE.DirectionalLight;
  private prato = new THREE.MeshLambertMaterial({ color: 0x93d26c });
  private chiazze = new THREE.MeshLambertMaterial({ color: 0x87c962 });
  /** [chioma, lato, cima] per tipo d'albero; il lato e' la chioma un po' piu' scura */
  private chiome = [0, 1, 2].map(() => [0, 1, 2].map(() => new THREE.MeshLambertMaterial()));
  private cespugli = [0, 1, 2].map(() => new THREE.MeshLambertMaterial());
  private foglieTerra: THREE.InstancedMesh | null = null;
  private fogliaGeo = new THREE.CircleGeometry(0.17, 7).scale(1.7, 1, 1).rotateX(-Math.PI / 2);
  private bianco = new THREE.MeshLambertMaterial({ color: 0xffffff });
  /** vetri del magazzino: di sera si accendono (emissive), di giorno sono vetro */
  private vetri = new THREE.MeshLambertMaterial({ color: 0xbfe6f4 });
  private luceLamp = new THREE.MeshBasicMaterial({ color: 0xfff1b8 });
  /** l'alone dei lampioni sul selciato, solo di sera (material.visible: niente da ricostruire) */
  private aloneGeo = new THREE.CircleGeometry(1.7, 24).rotateX(-Math.PI / 2);
  private aloneMat = new THREE.MeshBasicMaterial({ map: alone(), color: 0xffcf7a, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  /** gocce e fiocchi: nel riferimento della camera, scalati con lo zoom (stessa densita' sullo schermo a ogni distanza) */
  private schermo = new THREE.Group();
  /** nuvole (girano intorno all'isola, sopra il mare: non coprono mai pile e capannoni) e le loro ombre sull'isola */
  private cielo = new THREE.Group();
  private gocce: THREE.InstancedMesh | null = null;
  private nubi: THREE.InstancedMesh | null = null;
  private ombre: THREE.InstancedMesh | null = null;
  /** ombra di nuvola: la stessa macchia sfumata degli aloni, scura; scurisce tutto quello che copre (niente depthTest) */
  private ombraMat = new THREE.MeshBasicMaterial({ map: this.aloneMat.map, color: 0x0d1b2a, transparent: true, depthTest: false, depthWrite: false, fog: false });
  private gp: { u: number; v: number; s: number; vel: number; fase: number }[] = [];
  private np: { a: number; r: number; h: number; k: number }[] = [];
  private op: { s: number; w: number; k: number }[] = [];
  private tMeteo = 0;
  private tVento = 0;
  private fumi = new Map<string, Fumetto>();
  private avvisi = new Set<string>();
  private bandiere: THREE.InstancedMesh[] = [];
  private astaGeo = new THREE.CylinderGeometry(0.024, 0.024, 1, 6).translate(0, 0.5, 0);
  private AVVISO = new THREE.MeshLambertMaterial({ color: 0xf2852f, side: THREE.DoubleSide });

  /** Crea il proprio canvas dentro `container` (e lo toglie in dispose): un contesto WebGL nuovo a ogni montaggio. Lancia se il WebGL non c'e'. */
  constructor(container: HTMLElement, labelsEl: HTMLElement, hudEl: HTMLElement | null, ev: EventiMondo) {
    const canvas = document.createElement('canvas');
    canvas.className = 'v-canvas';
    canvas.setAttribute('aria-label', 'Villaggio Amimi: il magazzino con le borse impilate e i laboratori con le borse in preparazione');
    container.appendChild(canvas);
    this.canvas = canvas; this.labelsEl = labelsEl; this.hudEl = hudEl; this.ev = ev;
    this.reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.portrait = innerWidth / innerHeight < 0.8;
    try {
      this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    } catch (e) {
      canvas.remove();
      throw e;
    }
    VIVI++;
    try { this.allestisci(); } catch (e) { this.dispose(); throw e; }
  }
  /** Il resto del costruttore: se un passo lancia, dispose() libera canvas, contesto, listener e contatore. */
  private allestisci() {
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    // sul telefono 1,5x basta: il canvas a 2x costava il doppio dei pixel per frame
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.portrait ? 1.5 : 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // le ombre si ricalcolano solo quando qualcosa si muove o cambia (aggiorna, tween, furgoncino), non a ogni frame
    this.renderer.shadowMap.autoUpdate = false;
    for (const x of [this.disc, this.DISC.low, this.DISC.neg, this.DISC.inc, this.wheelGeo, this.rollGeo, this.spoolGeo, this.hideGeo, this.FLAG, this.flagGeo, this.stoneGeo]) this.keep.add(x);
    for (const x of this.persistenti()) this.keep.add(x);
    this.scene.background = new THREE.Color(0x86d4d4);
    // la nebbia c'e' sempre (lontanissima se non serve): accenderla dopo ricompilerebbe tutti i materiali
    this.scene.fog = new THREE.Fog(0xe1e8e7, 500, 1000);
    this.target = this.portrait ? new V3(0.6, 0, 0.6) : new V3(-2.6, 0, -2.6);
    this.viewH = Math.min(78, Math.max(30, 32 / (innerWidth / innerHeight)));
    this.resize(); this.placeCam();
    const onResize = () => this.resize();
    addEventListener('resize', onResize); this.off.push(() => removeEventListener('resize', onResize));

    this.hemi = new THREE.HemisphereLight(0xfff6e2, 0x88b86c, 0.62 * Math.PI);
    this.scene.add(this.hemi);
    const sun = new THREE.DirectionalLight(0xfff0d0, 0.62 * Math.PI);
    sun.position.set(-14, 40, 22); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -34, right: 34, top: 34, bottom: -34, near: 1, far: 120 });
    sun.shadow.camera.updateProjectionMatrix(); sun.shadow.bias = -0.0006;
    this.scene.add(sun); this.sun = sun;

    this.add(this.scene, new THREE.PlaneGeometry(400, 400), 0x7fd0d2, 0, -1.6, 0, { rx: -Math.PI / 2, cast: false });
    this.foam = this.add(this.scene, new THREE.TorusGeometry(28.8, 0.22, 6, 96), 0xf4fbf8, 0, -1.55, 0, { rx: Math.PI / 2, cast: false });
    this.add(this.scene, new THREE.CylinderGeometry(27.6, 28.6, 1.6, 72), 0xf1dfb0, 0, -1.9, 0, { cast: false });
    const island = new THREE.Mesh(new THREE.CylinderGeometry(25, 26, 2.4, 72), [this.mat(0xd8bf86), this.prato, this.mat(0xd8bf86)]);
    island.position.y = -1.2; island.receiveShadow = true; this.scene.add(island);
    const erba = new THREE.Group(); this.scene.add(erba);
    for (let i = 0; i < 16; i++) {
      const a = this.rnd() * 6.283, r = 6 + this.rnd() * 14;
      this.add(erba, new THREE.CircleGeometry(1.2 + this.rnd() * 2, 22), this.chiazze, Math.cos(a) * r, 0.012, Math.sin(a) * r, { rx: -Math.PI / 2, cast: false });
    }
    this.impasta(erba);
    this.buildWarehouseShell();
    this.whA = this.addLabel('', new V3(WCX, 8.7, WZ0 + 0.25), 'v-lbl v-wh', () => this.ev.onMagazzino());
    this.ginni = this.makeChar(0xee8fab, 0x7a4a2a);
    this.add(this.ginni, new THREE.SphereGeometry(0.22, 12, 10), 0x7a4a2a, 0, 2.05, -0.22);
    this.ginni.position.copy(GINNI); this.ginni.rotation.y = Math.PI / 4; this.ginni.userData.kind = 'ginni'; this.scene.add(this.ginni);
    this.ginni.add(this.corona);
    this.buildCart();
    this.buildFence();
    this.scene.add(this.paths); this.scene.add(this.decor); this.scene.add(this.premi);
    this.scene.add(this.schermo); this.scene.add(this.cielo);
    this.vesti(); this.illumina();
    this.bindPointer();
    const loop = (now: number) => { this.raf = requestAnimationFrame(loop); this.frameTick(now); };
    this.raf = requestAnimationFrame(loop);
  }

  private disposed = false;
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.off.forEach((f) => f());
    this.anchors.forEach((a) => a.el.remove());
    this.anchors = [];
    this.cartQ = [];
    this.smaltisci(this.scene, true);
    // quelli dell'ambiente che in questo momento nessuna mesh usa (alone di giorno, bandiere senza avvisi)
    this.aloneMat.map?.dispose();
    for (const x of this.persistenti()) x.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.canvas.remove();
    VIVI = Math.max(0, VIVI - 1);
    if (!VIVI) liberaCache();
  }
  /** Libera geometrie, materiali e InstancedMesh propri di un sottoalbero; quelli condivisi restano (tutti, se `tutto`, tranne le cache di modulo). */
  private smaltisci(root: THREE.Object3D, tutto = false) {
    root.traverse((o) => {
      if (o instanceof THREE.InstancedMesh) o.dispose();
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      if (!SHARED.has(m.geometry) && (tutto || !this.keep.has(m.geometry))) m.geometry.dispose();
      for (const x of Array.isArray(m.material) ? m.material : [m.material]) {
        if (SHARED.has(x) || (!tutto && this.keep.has(x))) continue;
        (x as THREE.MeshBasicMaterial).map?.dispose();
        x.dispose();
      }
    });
  }
  private svuota(g: THREE.Object3D) { while (g.children.length) { const c = g.children[0]; this.smaltisci(c); g.remove(c); } }
  /** Materiali e geometrie dell'ambiente che vivono quanto il Mondo (in keep: svuotando un gruppo restano). */
  private persistenti(): (THREE.Material | THREE.BufferGeometry)[] {
    return [this.prato, this.chiazze, ...this.chiome.flat(), ...this.cespugli, this.fogliaGeo, this.bianco, this.vetri, this.luceLamp, this.aloneGeo, this.aloneMat, this.ombraMat, this.astaGeo, this.AVVISO];
  }

  /* ---------- piccoli attrezzi ---------- */
  private MC: Record<number, THREE.MeshLambertMaterial> = {};
  private mat(c: number) { if (!this.MC[c]) { this.MC[c] = new THREE.MeshLambertMaterial({ color: c }); this.keep.add(this.MC[c]); } return this.MC[c]; }
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
  private tween(dur: number, fn: (p: number) => void, done?: () => void): Tween { const tw: Tween = { t0: performance.now(), dur: Math.max(1, dur), fn, done }; this.tweens.push(tw); this.sveglia(); return tw; }
  /** Qualcosa e' successo (tocco, dati, pannello): l'isola si rianima per RIPOSO_MS. */
  private sveglia() { this.ultimoInput = performance.now(); this.dirty = true; }
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
  private floatText(text: string, pos: THREE.Vector3, cls = '', ms = 1450) {
    const el = document.createElement('div');
    el.className = 'v-float ' + cls; el.textContent = text;
    this.labelsEl.appendChild(el);
    const a: Anchor = { el, pos: pos.clone(), free: true };
    this.anchors.push(a);
    setTimeout(() => this.dropLabel(a), ms);
    return a;
  }
  private resize() {
    this.dirty = true;
    const w = innerWidth, h = innerHeight, a = w / h;
    const portrait = a < 0.8;
    if (portrait !== this.portrait) { this.portrait = portrait; this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, portrait ? 1.5 : 2)); }
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
    this.camTw.ombre = false;
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
  setCtx(c: Ctx) { this.ctx = c; this.sveglia(); }
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
  /** Camera su una pila. Come focusMagazzino ricorda la vista di prima, cosi' chiudendo il giro di conta (anche aperto
   *  dalle missioni) ripristina() la rimette; `ricorda = false` quando nessun pannello resta aperto a riportarla indietro
   *  (la figura del pannello Magazzino), se no la prossima chiusura tornerebbe a una vista vecchia. */
  focusPila(key: string, ricorda = true) {
    const p = this.piles.get(key); this.ctx = null;
    if (!p) return;
    if (ricorda) this.remember();
    this.frame(p.x, p.z, this.portrait ? 11 : 10, 0.05);
    p.anchor.until = performance.now() + 4500;
  }

  /* ---------- magazzino ---------- */
  private buildWarehouseShell() {
    const WH = this.wh; WH.userData.kind = 'wh'; this.scene.add(WH); this.pickables.push(WH);
    const PINK = 0xf3a7bb, CREAM = 0xfff1dc;
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
    for (const x of [WX0 + 3, WX1 - 3]) { this.add(WH, box(1.8, 1.5, 0.12), CREAM, x, 3.1, WZ0 + 0.53); this.add(WH, box(1.4, 1.1, 0.14), this.vetri, x, 3.1, WZ0 + 0.54); }
    this.add(WH, box(0.12, 1.5, 1.8), CREAM, WX0 + 0.53, 3.1, WCZ); this.add(WH, box(0.14, 1.1, 1.4), this.vetri, WX0 + 0.54, 3.1, WCZ);
    for (const [x, z] of [[WX1 - 0.15, WZ1 - 0.15], [WX0 + 0.15, WZ1 - 0.15], [WX1 - 0.15, WZ0 + 0.15]]) this.add(WH, new THREE.CylinderGeometry(0.22, 0.22, 4.4, 10), CREAM, x, 2.4, z);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(5, 1.25), signMat('AMIMI', '', 0xc4607f));
    sign.position.set(WCX, 5.7, WZ0 + 0.56); WH.add(sign);
    WH.add(this.whInside);
    this.impasta(WH, [this.whInside]);
  }
  private disc = new THREE.CircleGeometry(1, 24);
  private DISC = { low: new THREE.MeshLambertMaterial({ color: 0xf2b84b }), neg: new THREE.MeshLambertMaterial({ color: 0xe0574b }), inc: new THREE.MeshLambertMaterial({ color: 0x9fd3ec }) };
  private layoutWarehouse(pile: PilaMondo[]) {
    for (const p of this.piles.values()) this.dropLabel(p.anchor);
    for (const z of this.zones.values()) this.dropLabel(z.anchor);
    this.piles.clear(); this.zones.clear();
    this.svuota(this.whInside);
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
    this.disegnaAvvisi();
  }
  private fillPile(p: PilaG, shrink: number) {
    const g = p.g;
    this.svuota(g);
    const P = partsFor(p.model), sc = PSC(p.model) * shrink;
    const st = Math.max(0, p.stock);
    const mk = p.stock < 0 || p.neg ? 'neg' : st > 0 && st <= 2 ? 'low' : st === 0 && p.incoming > 0 ? 'inc' : null;
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
    p.anchor.el.innerHTML = this.testoPila(p);
    p.anchor.w = 0;
    p.anchor.pos.set(p.x, p.top + 0.15, p.z);
  }
  private testoPila(p: PilaG) {
    const st = Math.max(0, p.stock);
    return esc(p.model) + '<small>' + esc(p.name) + ' · ' + (p.stock < 0 ? p.stock + ' pz (negativo)' : st + ' pz') + (p.incoming ? ' · ' + p.incoming + ' in arrivo' : '')
      + (this.avvisi.has(p.key) ? ' · sta finendo' : '') + '</small>';
  }
  /** Bandierine arancio sulle pile che stanno finendo (setAvvisiPile): due InstancedMesh per tutte (aste e teli),
   *  rifatte quando cambiano le pile o gli avvisi. Stanno dietro la pila (verso il fondo del fienile) e spuntano sopra. */
  private disegnaAvvisi() {
    for (const m of this.bandiere) if (m.parent) { m.parent.remove(m); m.dispose(); }
    this.bandiere = [];
    const ps = [...this.avvisi].map((k) => this.piles.get(k)).filter((p): p is PilaG => !!p);
    this.shadowDirty = true; this.dirty = true;
    if (!ps.length) return;
    const keys = ps.map((p) => p.key);
    const aste = new THREE.InstancedMesh(this.astaGeo, this.mat(0x5a4a3a), ps.length), teli = new THREE.InstancedMesh(this.flagGeo, this.AVVISO, ps.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion().setFromAxisAngle(new V3(0, 1, 0), Math.PI / 4), uno = new THREE.Quaternion();
    ps.forEach((p, i) => {
      const x = p.x + AWAY.x * p.cell * 0.34, z = p.z + AWAY.z * p.cell * 0.34, h = p.top - 0.52 + 0.42;
      aste.setMatrixAt(i, m4.compose(new V3(x, 0.52, z), uno, new V3(1, h, 1)));
      teli.setMatrixAt(i, m4.compose(new V3(x, 0.52 + h, z), q, new V3(1.5, 1.5, 1.5)));
    });
    for (const m of [aste, teli]) { m.castShadow = true; m.userData = { kind: 'avviso', keys }; this.whInside.add(m); this.bandiere.push(m); }
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
    this.add(arm, box(0.13, 0.45, 0.13), shirt, 0, -0.2, 0, { cast: false });
    this.add(arm, box(0.1, 0.1, 0.36), 0x8a8a96, 0, -0.42, 0.15, { cast: false });
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
    // la lampada del banco: la accende la sera (illumina), con la sua pozza di luce sul pavimento
    this.add(g, new THREE.CylinderGeometry(0.01, 0.01, 0.5, 4), 0x3d3a45, -0.3, 2.98, -2.3);
    this.add(g, new THREE.SphereGeometry(0.15, 10, 8), this.luceLamp, -0.3, 2.68, -2.3, { cast: false });
    const pozza = new THREE.Mesh(this.aloneGeo, this.aloneMat); pozza.position.set(-0.4, 0.32, -1.5); pozza.scale.setScalar(1.25); g.add(pozza);
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
    // il fumetto sta nell'etichetta del capannone, a sinistra del nome: sul telefono, a isola intera, un fumetto sopra
    // l'artigiano finiva sotto l'etichetta. Il suo tocco (o Invio) apre la verifica e non arriva all'etichetta (onLab)
    const suFumetto = (e: Event) => {
      if (!(e.target as Element | null)?.closest?.('.v-fum')) return;
      if (e instanceof KeyboardEvent && e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault(); e.stopPropagation(); this.ev.onFumetto?.(data.key);
    };
    anchor.el.addEventListener('click', suFumetto, true); anchor.el.addEventListener('keydown', suFumetto, true);
    const L: LabG = { g, yard, ch, puffs, hideSlot, rollSlot, spoolSlot, dock, anchor, pileAnchors: [], testo: '', html: '', data, index };
    this.stones(CART_HOME.x, CART_HOME.z, dock.x, dock.z);
    this.impasta(g, [ch, yard, hideSlot, rollSlot, spoolSlot, ...puffs]);
    return L;
  }
  private fillYard(L: LabG) {
    const Y = L.yard;
    this.svuota(Y);
    L.pileAnchors.forEach((a) => this.dropLabel(a)); L.pileAnchors = [];
    const manca = (r: RigaMondo) => (r.wip ? 0 : r.o - r.a);
    const o = L.data.righe.filter((r) => r.a < r.o).sort((a, b) => manca(b) - manca(a));
    o.slice(0, LAB_COLS * 3).forEach((l, i) => {
      const col = i % LAB_COLS, row = Math.floor(i / LAB_COLS);
      const x = (col - (LAB_COLS - 1) / 2) * LAB_CELL, z = row * LAB_ROW;
      const t = new THREE.Group(); t.position.set(x, 0.3, z); Y.add(t);
      this.add(t, box(0.98, 0.06, 0.84), 0x9aa1a8, 0, 0.16, 0);
      for (const [wx, wz] of [[-0.4, -0.34], [0.4, -0.34], [-0.4, 0.34], [0.4, 0.34]]) this.add(t, this.wheelGeo, 0x3d3a45, wx, 0.07, wz, { cast: false });
      for (const hx of [-0.45, 0.45]) this.add(t, box(0.04, 0.62, 0.04), 0x7d848c, hx, 0.48, -0.39);
      this.add(t, box(0.94, 0.04, 0.04), 0x7d848c, 0, 0.78, -0.39);
      const P = partsFor(l.model), sc = PSC(l.model);
      const miss = manca(l), n = Math.max(1, lastre(miss));
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
      const a = this.addLabel(l.wip ? '<b>?</b> pz' : '<b>' + miss + '</b> pz', wp, 'v-lbl v-mini v-yard');
      a.el.title = l.model + ' ' + l.label;
      a.cond = (now) => (this.ctx?.type === 'lab' && this.ctx.lab === L.data.key) || now < (a.until ?? 0);
      L.pileAnchors.push(a);
    });
    for (const slot of [L.hideSlot, L.rollSlot, L.spoolSlot]) this.svuota(slot);
    if (o[0]) { const h = new THREE.Mesh(this.hideGeo, matsFor(o[0].look).body); h.receiveShadow = true; L.hideSlot.add(h); }
    const looks: Look[] = [];
    o.forEach((l) => { if (!looks.some((k) => k.key === l.look.key)) looks.push(l.look); });
    const RP = [[2.0, 1.67], [2.6, 1.67], [2.0, 2.37], [2.6, 2.37]];
    looks.slice(0, 4).forEach((lk, i) => { const r = new THREE.Mesh(this.rollGeo, matsFor(lk).body); r.position.set(RP[i][0], RP[i][1], -2.45); r.castShadow = true; L.rollSlot.add(r); });
    looks.slice(0, 3).forEach((lk, i) => { this.add(L.spoolSlot, this.spoolGeo, lk.cols[0], 0, 0, i * 0.18); });
    const pz = L.data.pz;
    const late = o.filter((l) => l.late).length;
    L.testo = '<b>' + esc(L.data.nome) + '</b><small>' + (o.length ? pz + ' pz in preparazione' : 'tutto arrivato') + '</small>' + (late ? '<span class="v-bang" title="' + late + ' righe in ritardo">!</span>' : '');
    this.etichettaLab(L);
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
    const postGeo = box(0.22, 1.0, 0.22), F = new THREE.Group();
    this.scene.add(F);
    fp.forEach(([x, z], i) => {
      this.add(F, postGeo, 0xfff4e0, x, 0.5, z);
      if (i > 0) {
        const [px, pz] = fp[i - 1]; const dx = x - px, dz = z - pz; const len = Math.hypot(dx, dz);
        for (const y of [0.42, 0.78]) this.add(F, box(len, 0.1, 0.08), 0xfff4e0, (x + px) / 2, y, (z + pz) / 2, { ry: Math.atan2(-dz, dx) });
      }
    });
    this.impasta(F);
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
    this.svuota(D);
    this.occupati = [];
    const free = (x: number, z: number, r: number) => used.every(([ux, uz]) => Math.hypot(ux - x, uz - z) > r);
    const alberi: [number, number, number][] = [];
    // i colori di chiome, cespugli e prato li mette vesti() (stagione): qui i materiali, uno per tipo e per parte
    const tree = (x: number, z: number, tipo: number, sc: number) => {
      if (!free(x, z, 6.2)) return;
      this.occupati.push([x, z, 2 * sc]); alberi.push([x, z, sc]);
      const g = new THREE.Group(); g.position.set(x, 0, z); g.scale.setScalar(sc); D.add(g);
      const [chioma, lato, cima] = this.chiome[tipo];
      this.add(g, new THREE.CylinderGeometry(0.28, 0.4, 1.7, 9), 0x9a6a43, 0, 0.85, 0);
      this.add(g, new THREE.SphereGeometry(1.4, 16, 12), chioma, 0, 2.5, 0);
      this.add(g, new THREE.SphereGeometry(1.0, 14, 10), lato, 0.85, 2.1, 0.3);
      this.add(g, new THREE.SphereGeometry(1.0, 14, 10), lato, -0.75, 2.15, -0.25);
      this.add(g, new THREE.SphereGeometry(0.9, 14, 10), cima, 0.1, 3.3, 0.1);
    };
    const bush = (x: number, z: number, s: number) => {
      if (!free(x, z, 5.2)) return;
      this.occupati.push([x, z, 1.6 * s]);
      const g = new THREE.Group(); g.position.set(x, 0, z); g.scale.setScalar(s); D.add(g);
      this.add(g, new THREE.SphereGeometry(0.9, 12, 10), this.cespugli[0], 0, 0.55, 0);
      this.add(g, new THREE.SphereGeometry(0.7, 12, 10), this.cespugli[1], 0.8, 0.45, 0.2);
      this.add(g, new THREE.SphereGeometry(0.65, 12, 10), this.cespugli[2], -0.7, 0.42, 0.1);
      const FL = [0xf27a8c, 0xf6d04d, 0xffffff, 0xb08ae0];
      for (let i = 0; i < 5; i++) this.add(g, new THREE.SphereGeometry(0.14, 8, 6), FL[i % 4], (this.rnd() - 0.5) * 1.6, 0.9 + this.rnd() * 0.4, (this.rnd() - 0.5) * 1.0, { cast: false });
    };
    ([[-19, -8.5, 0, 1.05], [-12, -16.5, 1, 1], [-4, -15.8, 0, 1.15], [5.5, -15, 1, 0.95], [10, -16, 0, 1], [15, -12.5, 0, 1.05],
      [18, -4, 2, 1], [-19, -2, 0, 1.05], [-17, 4.5, 1, 1], [-13.5, 3.4, 2, 0.85], [19, 2.5, 0, 0.9]] as [number, number, number, number][]).forEach((t) => tree(t[0], t[1], t[2], t[3]));
    ([[14, 12], [7.5, 17], [-2, 17.5], [-12, 14.5], [17.5, 8.5], [-16, 10], [0.5, 5.2], [-9.5, 3.5]] as [number, number][]).forEach((b) => bush(b[0], b[1], 0.9 + this.rnd() * 0.3));
    // foglie a terra sotto gli alberi: una InstancedMesh sola, accesa da vesti() solo d'autunno
    const N = alberi.length * 9;
    this.foglieTerra = null;
    if (N) {
      const F = new THREE.InstancedMesh(this.fogliaGeo, this.bianco, N), R = rngFor('foglie'), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color();
      alberi.forEach(([x, z, sc], t) => {
        for (let i = 0; i < 9; i++) {
          const a = R() * 6.283, r = (1.1 + R() * 1.7) * sc, k = t * 9 + i;
          q.setFromAxisAngle(new V3(0, 1, 0), R() * 6.283);
          F.setMatrixAt(k, m4.compose(new V3(x + Math.cos(a) * r, 0.03 + R() * 0.01, z + Math.sin(a) * r), q, new V3(1, 1, 1).multiplyScalar(0.8 + R() * 0.5)));
          F.setColorAt(k, c.setHex(FOGLIE[k % FOGLIE.length]));
        }
      });
      F.receiveShadow = true; F.visible = VESTI[this.amb.stagione].foglie;
      D.add(F); this.foglieTerra = F;
    }
    this.impasta(D);
  }

  /* ---------- dati: si ricostruiscono magazzino e laboratori ---------- */
  aggiorna(dati: DatiMondo) {
    this.layoutWarehouse(dati.pile);
    const keys = dati.labs.slice(0, LAB_SLOTS.length).map((l) => l.key);
    const same = keys.length === this.labs.size && keys.every((k, i) => this.labs.get(k)?.index === i);
    if (!same) {
      for (const L of this.labs.values()) { this.scene.remove(L.g); this.smaltisci(L.g); this.dropLabel(L.anchor); L.pileAnchors.forEach((a) => this.dropLabel(a)); const pi = this.pickables.indexOf(L.g); if (pi >= 0) this.pickables.splice(pi, 1); }
      this.labs.clear();
      this.svuota(this.paths);
      dati.labs.slice(0, LAB_SLOTS.length).forEach((d, i) => this.labs.set(d.key, this.buildLab(d, i)));
      this.impasta(this.paths);
      this.buildDecor(keys.map((_, i) => LAB_SLOTS[i]));
      // le aiuole seguono i sentieri, che cambiano con i capannoni
      if (this.livello) this.buildPremi();
    }
    dati.labs.slice(0, LAB_SLOTS.length).forEach((d) => { const L = this.labs.get(d.key); if (L) { L.data = d; this.fillYard(L); } });
    this.whA.el.innerHTML = 'Magazzino<small>' + dati.totale + ' pezzi</small>'; this.whA.w = 0;
    this.shadowDirty = true; this.sveglia();
  }
  /** Punto di carico del capannone (copia), null se il capannone non c'e'. La pagina lo legge dopo aggiorna() (i posti
   *  scorrono quando un laboratorio sparisce) e tiene quello letto prima solo per un capannone sparito. */
  dockOf(labKey: string): THREE.Vector3 | null { const L = this.labs.get(labKey); return L ? L.dock.clone() : null; }
  /** Il furgoncino va dal punto di carico al magazzino con `n` pezzi della variante; alla fine la pila fa un saltello. */
  arrivo(dock: THREE.Vector3 | null, riga: RigaMondo, n: number, pilaKey: string) {
    const go = () => {
      if (this.disposed) return;
      if (!dock) { this.cartBusy = false; this.next(); return; }
      this.cartBusy = true;
      this.ev.onPartenza?.(n);
      this.drive(dock, () => {
        this.svuota(this.cartLoad);
        const k = Math.min(4, Math.max(1, Math.round(n / 8))), P = partsFor(riga.model), s = Math.min(0.75, 0.75 / P.w);
        for (let i = 0; i < k; i++) { const b = makeBag(riga.model, riga.look); b.scale.setScalar(s); b.position.set(i % 2 ? 0.38 : -0.38, 0, i < 2 ? -0.22 : 0.22); b.rotation.y = Math.PI / 2; this.cartLoad.add(b); }
        setTimeout(() => { if (!this.disposed) this.drive(CART_HOME, () => {
          this.svuota(this.cartLoad);
          const p = this.piles.get(pilaKey);
          if (p) {
            this.tween(this.reduce ? 1 : 560, (t) => { p.g.scale.set(1, 0.55 + 0.45 * back(t), 1); });
            this.floatText('+' + n, new V3(p.x, p.top + 0.9, p.z));
            p.anchor.until = performance.now() + 3500;
          }
          this.cart.rotation.y = -Math.PI / 2;
          setTimeout(() => { this.cartBusy = false; this.next(); }, 350);
        }); }, 350);
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

  /* ---------- ambiente (fase 3): stagione, luce del giorno, meteo, fumetti, avvisi ---------- */
  /** Stagione (chiome, prato, foglie a terra), momento del giorno (cielo, luci, finestre e lampioni accesi la sera) e
   *  meteo (nuvole, gocce, fiocchi, foschia). La pagina lo chiama all'apertura e ogni 15 minuti (meteo.ts): cambia
   *  colori e luci una volta e chiede un disegno solo, senza svegliare l'isola. Valori sconosciuti = giorno sereno d'estate. */
  setAmbiente(a: Ambiente) {
    const b: Ambiente = { stagione: di(VESTI, a.stagione) ? a.stagione : 'estate', momento: di(LUCI, a.momento) ? a.momento : 'giorno', meteo: di(METEO_LUCE, a.meteo) ? a.meteo : 'sereno' };
    const prima = this.amb;
    this.amb = b;
    if (b.stagione !== prima.stagione) this.vesti();
    if (b.meteo !== prima.meteo) this.preparaMeteo();
    this.illumina();
  }
  /** I fumetti sopra gli artigiani, per chiave di laboratorio (null o assente = nessun fumetto). Il tocco chiama onFumetto. */
  setFumetti(f: Map<string, Fumetto | null> | Record<string, Fumetto | null>) {
    this.fumi.clear();
    for (const [k, v] of f instanceof Map ? f : Object.entries(f)) if (di(ICONA, v)) this.fumi.set(k, v);
    for (const L of this.labs.values()) this.etichettaLab(L);
  }
  /** Le pile (chiavi di PilaMondo) che stanno finendo: una bandierina arancio e "sta finendo" nell'etichetta. */
  setAvvisiPile(keys: Iterable<string>) {
    const nuovi = new Set(keys), prima = this.avvisi;
    if (nuovi.size === prima.size && [...nuovi].every((k) => prima.has(k))) return;
    this.avvisi = nuovi;
    for (const p of this.piles.values()) if (prima.has(p.key) !== nuovi.has(p.key)) { p.anchor.el.innerHTML = this.testoPila(p); p.anchor.w = 0; }
    this.disegnaAvvisi();
  }
  /** L'etichetta del capannone (testo di fillYard) con il fumetto, se c'e', come bottone suo (icone SVG: niente testo
   *  in piu' nell'etichetta). */
  private etichettaLab(L: LabG) {
    const f = this.fumi.get(L.data.key), el = L.anchor.el;
    const html = L.testo + (f ? '<span class="v-fum ' + f + '" role="button" tabindex="0" aria-label="' + esc(DETTO[f](L.data.nome)) + '" title="' + esc(DETTO[f](L.data.nome)) + '"><span class="v-fumb">' + ICONA[f] + '</span></span>' : '');
    // stesso contenuto: niente da riscrivere (il fumetto rifarebbe il suo salto d'ingresso a ogni lettura dei dati)
    if (L.html === html) return;
    L.html = html; el.innerHTML = html;
    el.classList.toggle('con-fum', !!f);
    L.anchor.w = 0;
  }

  /** Colori della stagione sui materiali condivisi di prato, alberi e cespugli; le foglie a terra solo d'autunno. */
  private vesti() {
    const V = VESTI[this.amb.stagione];
    this.prato.color.setHex(V.prato); this.chiazze.color.setHex(V.chiazze);
    V.chiome.forEach(([c, cima], i) => { const [chioma, lato, alto] = this.chiome[i]; chioma.color.setHex(c); lato.color.setHex(c).multiplyScalar(0.88); alto.color.setHex(cima); });
    V.cespugli.forEach((c, i) => this.cespugli[i].color.setHex(c));
    if (this.foglieTerra) this.foglieTerra.visible = V.foglie;
    this.dirty = true;
  }
  /** Luci del momento corrette dal meteo, cielo e nebbia, finestre e lampioni (accesi solo la sera). */
  private illumina() {
    const L = LUCI[this.amb.momento], M = METEO_LUCE[this.amb.meteo], sera = this.amb.momento === 'sera';
    const grigio = (c: number) => mix(c, sera ? 0x46506a : 0xb6bec8, M.grigio);
    this.hemi.color.setHex(grigio(L.emi[0])); this.hemi.groundColor.setHex(L.emi[1]); this.hemi.intensity = L.emi[2] * M.emi * Math.PI;
    this.sun.color.setHex(grigio(L.sole[0])); this.sun.intensity = L.sole[1] * M.sole * Math.PI;
    this.sun.position.set(L.dir[0], L.dir[1], L.dir[2]);
    const fog = this.scene.fog as THREE.Fog, nebbia = this.amb.meteo === 'nebbia';
    (this.scene.background as THREE.Color).setHex(nebbia ? L.nebbia : grigio(L.cielo));
    fog.color.setHex(L.nebbia); fog.near = nebbia ? 46 : 500; fog.far = nebbia ? 104 : 1000;
    this.vetri.color.setHex(sera ? 0xffe2a0 : 0xbfe6f4); this.vetri.emissive.setHex(sera ? 0xf2b458 : 0x000000);
    this.luceLamp.color.setHex(sera ? 0xffe08a : 0xf3ecd6);
    this.aloneMat.visible = sera;
    if (this.nubi) (this.nubi.material as THREE.MeshLambertMaterial).emissive.setHex(sera ? 0x1c2440 : 0x2a2a2a);
    this.shadowDirty = true; this.dirty = true;
  }
  /** Gocce o fiocchi (nel riferimento della camera) e nuvole (nel mondo) del meteo di adesso: una InstancedMesh ciascuno. */
  private preparaMeteo() {
    this.svuota(this.schermo); this.svuota(this.cielo);
    this.gocce = null; this.nubi = null; this.ombre = null; this.gp = []; this.np = []; this.op = [];
    const meteo = this.amb.meteo, R = rngFor('meteo' + meteo);
    if (meteo === 'pioggia' || meteo === 'neve') {
      const neve = meteo === 'neve', N = neve ? 150 : 190;
      // misure in altezze dello schermo: il gruppo e' scalato di viewH
      const geo = neve ? new THREE.CircleGeometry(0.0062, 7) : new THREE.PlaneGeometry(0.0028, 0.046);
      const mat = new THREE.MeshBasicMaterial({ color: neve ? 0xffffff : 0xe2eef8, transparent: true, opacity: neve ? 0.95 : 0.5, depthTest: false, depthWrite: false, fog: false });
      const m = new THREE.InstancedMesh(geo, mat, N);
      m.frustumCulled = false; m.renderOrder = 10;
      this.gp = Array.from({ length: N }, () => ({ u: R() - 0.5, v: R() * 1.1 - 0.55, s: 0.6 + R() * 0.8, vel: neve ? 0.045 + R() * 0.045 : 0.75 + R() * 0.45, fase: R() * 6.283 }));
      this.schermo.add(m); this.gocce = m;
    }
    const quante = meteo === 'nuvole' ? 6 : meteo === 'pioggia' ? 8 : meteo === 'neve' ? 5 : 0;
    if (quante) {
      // nuvoletta: cinque sfere fuse, la pancia schiacciata
      const sfere = [[0, 0, 0, 1], [1.05, -0.12, 0.15, 0.74], [-1.0, -0.16, -0.05, 0.7], [0.42, 0.5, 0, 0.66], [-0.45, 0.38, 0.1, 0.6]].map(([x, y, z, r]) => new THREE.SphereGeometry(r, 12, 9).translate(x, y, z));
      const geo = mergeGeometries(sfere, false) as THREE.BufferGeometry;
      sfere.forEach((g) => g.dispose());
      geo.scale(1, 0.72, 0.8);
      const col = meteo === 'pioggia' ? 0xa7b0bb : meteo === 'neve' ? 0xeef2f5 : 0xffffff;
      const mat = new THREE.MeshLambertMaterial({ color: col, emissive: this.amb.momento === 'sera' ? 0x1c2440 : 0x2a2a2a, transparent: true, opacity: 0.9, depthWrite: false });
      const m = new THREE.InstancedMesh(geo, mat, quante);
      m.frustumCulled = false;
      this.np = Array.from({ length: quante }, (_, k) => ({ a: (k + R() * 0.6) / quante * 6.283, r: 30 + R() * 5, h: 6 + R() * 3, k: 1.0 + R() * 0.7 }));
      this.cielo.add(m); this.nubi = m;
      if (meteo !== 'neve') {
        const n = 5, o = new THREE.InstancedMesh(this.aloneGeo, this.ombraMat, n);
        o.frustumCulled = false; o.renderOrder = 5;
        this.ombraMat.opacity = meteo === 'pioggia' ? 0.34 : 0.28;
        this.op = Array.from({ length: n }, (_, k) => ({ s: (k / n) * 70 - 35 + R() * 5, w: -16 + R() * 30, k: 2.6 + R() * 1.6 }));
        this.cielo.add(o); this.ombre = o;
      }
    }
    this.tMeteo = performance.now();
    this.dirty = true;
  }
  /** Le gocce cadono, i fiocchi ondeggiano e le nuvole passano solo da sveglia (`muovi`); a riposo e con
   *  prefers-reduced-motion restano dove sono. Le matrici si ricompongono a ogni disegno: lo zoom e la forma dello
   *  schermo cambiano anche da fermi. */
  private passoMeteo(now: number, muovi: boolean) {
    const dt = muovi ? Math.min(0.1, Math.max(0, now - this.tMeteo) / 1000) : 0;
    this.tMeteo = now; this.tVento += dt;
    const m4 = new THREE.Matrix4(), s3 = new V3(), p3 = new V3();
    if (this.gocce) {
      const a = innerWidth / innerHeight, neve = this.amb.meteo === 'neve', inclina = neve ? 0 : 0.14;
      const q = new THREE.Quaternion().setFromAxisAngle(new V3(0, 0, 1), -inclina);
      this.schermo.position.copy(this.target); this.schermo.quaternion.copy(this.camera.quaternion); this.schermo.scale.set(this.viewH, this.viewH, 1);
      // tutte su uno schermo largo; su uno stretto (telefono in verticale) meno, cosi' la pioggia e' fitta uguale
      const quante = Math.max(1, Math.min(this.gp.length, Math.round(this.gp.length * a / 1.6)));
      this.gocce.count = quante;
      this.gp.slice(0, quante).forEach((g, i) => {
        if (dt) {
          g.v -= g.vel * dt;
          g.u -= g.vel * dt * Math.sin(inclina) / a;
          if (g.v < -0.55) g.v += 1.1;
          g.u = ((g.u + 0.5) % 1 + 1) % 1 - 0.5;
        }
        const x = g.u * a * 1.06 + (neve ? Math.sin(this.tVento * 0.9 + g.fase) * 0.012 : 0);
        this.gocce?.setMatrixAt(i, m4.compose(p3.set(x, g.v, 40), q, s3.set(g.s, neve ? g.s : 0.8 + g.s * 0.3, 1)));
      });
      this.gocce.instanceMatrix.needsUpdate = true;
    }
    const uno = new THREE.Quaternion();
    if (this.nubi) {
      this.np.forEach((n, i) => {
        n.a += dt * 0.02;
        this.nubi?.setMatrixAt(i, m4.compose(p3.set(Math.cos(n.a) * n.r, n.h, Math.sin(n.a) * n.r), uno, s3.setScalar(n.k)));
      });
      this.nubi.instanceMatrix.needsUpdate = true;
    }
    if (this.ombre) {
      this.op.forEach((o, i) => {
        o.s += dt * 0.7; if (o.s > 36) o.s -= 72;
        p3.copy(RIGHT).multiplyScalar(o.s).addScaledVector(AWAY, o.w); p3.y = 0.05;
        this.ombre?.setMatrixAt(i, m4.compose(p3, uno, s3.set(o.k, 1, o.k * 0.7)));
      });
      this.ombre.instanceMatrix.needsUpdate = true;
    }
  }

  /* ---------- Paillettes: premi dei livelli, festa, punti ---------- */
  /** Decorazioni sbloccate fino al livello `i` (0 Stagista .. 6 Executive Queen), cumulative. Lo stesso livello non ricostruisce. */
  setLivello(i: number) {
    const n = Math.max(0, Math.min(6, Math.floor(i) || 0));
    this.sveglia();
    if (n === this.livello) return;
    this.livello = n;
    this.buildPremi();
  }
  /** Chiamata da setLivello e da aggiorna() quando cambiano i capannoni (che poi svegliano l'isola). */
  private buildPremi() {
    this.svuota(this.premi); this.svuota(this.corona); this.pallone = null;
    const n = this.livello;
    if (n >= 1) this.aiuole();
    if (n >= 2) this.fontana();
    if (n >= 3) this.lampioni();
    if (n >= 4) this.chiosco();
    if (n >= 5) this.mongolfiera();
    if (n >= 6) { this.tappeto(); this.coronaGinni(); }
    // la mongolfiera si muove: fusa a parte, dentro il suo gruppo
    this.impasta(this.premi, this.pallone ? [this.pallone] : []);
    if (this.pallone) this.impasta(this.pallone);
    this.impasta(this.corona);
    this.shadowDirty = true;
  }
  /** Livello 1: aiuole fiorite ai due lati dei sentieri, solo dove non toccano capannoni, magazzino, furgoncino, alberi,
   *  altri sentieri e i premi dei livelli dopo. */
  private aiuole() {
    const segs = [...this.labs.values()].map((L): [THREE.Vector3, THREE.Vector3] => [CART_HOME, L.dock]);
    const prese: [number, number, number][] = [];
    const libero = (x: number, z: number, r: number) => {
      if (Math.hypot(x, z) > 20.5 - r) return false;
      if (x > WX0 - r - 0.4 && x < WX1 + r + 0.4 && z > WZ0 - r - 0.4 && z < WZ1 + r + 0.4) return false;
      if (Math.hypot(x - CART_HOME.x, z - CART_HOME.z) < 2.3 + r) return false;
      for (const L of this.labs.values()) if (Math.hypot(x - L.g.position.x, z - L.g.position.z) < 4.7 + r) return false;
      if (segs.some(([a, b]) => distSeg(x, z, a, b) < 0.65 + r)) return false;
      return [...this.occupati, ...INGOMBRI, ...prese].every(([ox, oz, or]) => Math.hypot(x - ox, z - oz) >= or + r);
    };
    const FL = [0xf27a8c, 0xf6d04d, 0xb08ae0];
    for (const [a, b] of segs) {
      const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz), ux = dx / len, uz = dz / len;
      for (let s = 2.6; s <= len - 1.6; s += 1.9) for (const lato of [-1, 1]) {
        const x = a.x + ux * s - uz * lato * 1.2, z = a.z + uz * s + ux * lato * 1.2;
        // l'aiuola e' lunga: due cerchi lungo il sentiero
        if (!libero(x + ux * 0.55, z + uz * 0.55, 0.45) || !libero(x - ux * 0.55, z - uz * 0.55, 0.45)) continue;
        const k = prese.length, R = rngFor('aiuola' + k);
        prese.push([x, z, 1.0]);
        const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = Math.atan2(-uz, ux); this.premi.add(g);
        this.add(g, new THREE.CylinderGeometry(0.5, 0.54, 0.14, 12), 0xeee2c2, 0, 0.07, 0, { s: [1.75, 1, 0.68], cast: false });
        this.add(g, new THREE.SphereGeometry(0.5, 12, 6), 0x8a5a3a, 0, 0.12, 0, { s: [1.6, 0.24, 0.56], cast: false });
        for (let j = 0; j < 5; j++) {
          const fx = (j - 2) * 0.3 + (R() - 0.5) * 0.08, fz = (R() - 0.5) * 0.14;
          this.add(g, new THREE.SphereGeometry(0.15, 8, 6), 0x6db54a, fx, 0.25, fz, { cast: false });
          this.add(g, new THREE.SphereGeometry(0.1, 8, 6), j % 2 ? 0xffffff : FL[k % FL.length], fx + (R() - 0.5) * 0.06, 0.38, fz, { cast: false });
        }
      }
    }
  }
  /** Livello 2: fontana rosa e crema nella piazzetta davanti al magazzino. */
  private fontana() {
    const g = new THREE.Group(); g.position.copy(FONTANA); this.premi.add(g);
    const PINK = 0xf3a7bb, CREAM = 0xfff1dc, SPRUZZO = 0xbfe6f4;
    const acqua = new THREE.MeshPhongMaterial({ color: 0x8fd3ec, shininess: 80, specular: 0xffffff });
    this.add(g, new THREE.CylinderGeometry(1.45, 1.55, 0.5, 18), PINK, 0, 0.25, 0);
    this.add(g, new THREE.TorusGeometry(1.42, 0.13, 6, 24), CREAM, 0, 0.52, 0, { rx: Math.PI / 2 });
    this.add(g, new THREE.CylinderGeometry(1.32, 1.32, 0.06, 18), acqua, 0, 0.45, 0, { cast: false });
    this.add(g, new THREE.CylinderGeometry(0.2, 0.32, 1.0, 10), CREAM, 0, 0.95, 0);
    this.add(g, new THREE.CylinderGeometry(0.62, 0.3, 0.22, 14), PINK, 0, 1.5, 0);
    this.add(g, new THREE.TorusGeometry(0.6, 0.06, 6, 18), CREAM, 0, 1.61, 0, { rx: Math.PI / 2 });
    this.add(g, new THREE.CylinderGeometry(0.55, 0.55, 0.04, 14), acqua, 0, 1.6, 0, { cast: false });
    this.add(g, new THREE.SphereGeometry(0.15, 10, 8), CREAM, 0, 1.72, 0);
    this.add(g, new THREE.CylinderGeometry(0.03, 0.08, 0.4, 8), SPRUZZO, 0, 1.98, 0, { cast: false });
    this.add(g, new THREE.SphereGeometry(0.1, 8, 6), SPRUZZO, 0, 2.2, 0, { cast: false });
    // archi d'acqua dal bordo della vasca alta a quella bassa
    for (let k = 0; k < 6; k++) {
      const a = (k + 0.5) / 6 * 6.283, c = Math.cos(a), s = Math.sin(a);
      this.add(g, tube([[0.6, 1.52], [0.84, 1.42], [0.99, 1.05], [1.05, 0.5]].map(([r, y]) => new V3(c * r, y, s * r)), 0.04), SPRUZZO, 0, 0, 0, { cast: false });
    }
  }
  /** Livello 3: lampioni intorno alla fontana e una panchina che la guarda. */
  private lampioni() {
    const SCURO = 0x3d3a45, LEGNO = 0xbb8650;
    // la lanterna e l'alone a terra sono dell'ambiente: di sera si accendono (illumina), una draw call per tutti gli aloni
    const aloni = new THREE.InstancedMesh(this.aloneGeo, this.aloneMat, LAMPIONI.length), m4 = new THREE.Matrix4();
    LAMPIONI.forEach(([x, z], i) => {
      const g = new THREE.Group(); g.position.set(x, 0, z); this.premi.add(g);
      this.add(g, new THREE.CylinderGeometry(0.14, 0.19, 0.22, 8), SCURO, 0, 0.11, 0);
      this.add(g, new THREE.CylinderGeometry(0.05, 0.065, 2.1, 8), SCURO, 0, 1.25, 0);
      this.add(g, new THREE.CylinderGeometry(0.17, 0.12, 0.34, 8), this.luceLamp, 0, 2.47, 0, { cast: false });
      this.add(g, new THREE.CylinderGeometry(0.03, 0.24, 0.18, 8), SCURO, 0, 2.73, 0);
      this.add(g, new THREE.SphereGeometry(0.055, 8, 6), GOLD, 0, 2.85, 0);
      aloni.setMatrixAt(i, m4.makeTranslation(x, 0.025 + i * 0.002, z));
    });
    aloni.renderOrder = 1; this.premi.add(aloni);
    const b = new THREE.Group(); b.position.copy(PANCHINA); b.rotation.y = Math.PI / 2; this.premi.add(b);
    for (const sx of [-0.68, 0.68]) { this.add(b, box(0.08, 0.42, 0.44), SCURO, sx, 0.21, 0); this.add(b, box(0.07, 0.55, 0.07), SCURO, sx, 0.7, -0.24); }
    for (const sz of [-0.15, 0, 0.15]) this.add(b, box(1.56, 0.06, 0.13), LEGNO, 0, 0.45, sz);
    for (const sy of [0.66, 0.86]) this.add(b, box(1.56, 0.12, 0.05), LEGNO, 0, sy, -0.26);
  }
  /** Livello 4: chiosco-boutique con la tenda a righe rosa, due borse sul banco e l'insegna. */
  private chiosco() {
    const g = new THREE.Group(); g.position.copy(CHIOSCO); g.rotation.y = Math.PI / 4; this.premi.add(g);
    const PINK = 0xf3a7bb, CREAM = 0xfff1dc, ROSA = 0xf08fb0, tenda = righeMat(ROSA, 0xfff8ea, 5);
    this.add(g, box(2.2, 0.14, 1.5), CREAM, 0, 0.07, 0);
    this.add(g, box(2.0, 0.9, 0.5), PINK, 0, 0.59, 0.4);
    this.add(g, box(2.12, 0.08, 0.62), CREAM, 0, 1.08, 0.4);
    this.add(g, box(2.0, 2.5, 0.12), plankMat(mix(PINK, CREAM, 0.55)), 0, 1.39, -0.62);
    for (const sx of [-1.0, 1.0]) this.add(g, new THREE.CylinderGeometry(0.06, 0.06, 2.02, 8), CREAM, sx, 1.14, 0.62);
    // tenda inclinata verso il cliente; la mantovana e i festoni pendono dal suo bordo davanti
    this.add(g, box(2.4, 0.05, 1.6), tenda, 0, 2.32, 0.08, { rx: 0.3 });
    this.add(g, box(2.4, 0.2, 0.04), tenda, 0, 1.99, 0.85);
    // festoni negli stessi colori dei fiori delle aiuole: si fondono con loro
    for (let j = 0; j < 8; j++) this.add(g, new THREE.SphereGeometry(0.1, 8, 6), j % 2 ? 0xffffff : 0xf27a8c, -1.05 + j * 0.3, 1.89, 0.85, { cast: false });
    for (const [m, v, x, s] of [['Lea', 'PATENT PINK', -0.5, 0.42], ['Annie', 'PAILLETTES PINK', 0.45, 0.55]] as [Modello, string, number, number][]) {
      const bag = makeBag(m, parseLook(m, v)); bag.scale.setScalar(s); bag.position.set(x, 1.12, 0.4); bag.rotation.y = -0.2; g.add(bag);
    }
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 0.45), signMat('BOUTIQUE', '', 0xc4607f));
    sign.position.set(0, 2.88, -0.54); g.add(sign);
  }
  /** Livello 5: mongolfiera rosa a spicchi. Ondeggia in frameTick solo da sveglia; a riposo torna ferma (posa). */
  private mongolfiera() {
    const g = new THREE.Group(); g.position.copy(PALLONE); this.premi.add(g); this.pallone = g;
    const prof = [[0.34, 0], [0.5, 0.25], [0.95, 0.85], [1.38, 1.65], [1.58, 2.45], [1.55, 3.1], [1.3, 3.65], [0.82, 4.02], [0.001, 4.18]];
    this.add(g, new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 16), righeMat(0xf08fb0, 0xfff1dc, 8), 0, 0, 0, { cast: false });
    this.add(g, new THREE.TorusGeometry(0.36, 0.05, 6, 16), GOLD, 0, 0.02, 0, { rx: Math.PI / 2, cast: false });
    this.add(g, new THREE.SphereGeometry(0.12, 8, 6), GOLD, 0, 4.2, 0, { cast: false });
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) this.add(g, new THREE.CylinderGeometry(0.015, 0.015, 0.95, 5), 0x5a4a3a, sx * 0.3, -0.47, sz * 0.3, { cast: false });
    this.add(g, box(0.64, 0.48, 0.64), 0xa8743f, 0, -1.18, 0, { cast: false });
    this.add(g, box(0.72, 0.09, 0.72), 0x9a6a3f, 0, -0.93, 0, { cast: false });
  }
  /** Livello 6: tappeto rosso da Ginni al lato aperto del magazzino, con i bordi d'oro e i cordoni. */
  private tappeto() {
    const { x0, x1 } = TAPPETO, len = x1 - x0, cx = (x0 + x1) / 2, z = GINNI.z, P = this.premi;
    this.add(P, box(len, 0.03, 1.0), 0xc8323b, cx, 0.016, z, { cast: false });
    for (const s of [-1, 1]) this.add(P, box(len, 0.04, 0.07), GOLD, cx, 0.02, z + s * 0.5, { cast: false });
    const pali = [x0 + 0.35, x0 + 1.45, x0 + 2.55];
    for (const s of [-1, 1]) {
      const pz = z + s * 0.78;
      for (const px of pali) {
        this.add(P, new THREE.CylinderGeometry(0.15, 0.17, 0.06, 10), GOLD, px, 0.03, pz);
        this.add(P, new THREE.CylinderGeometry(0.035, 0.045, 0.78, 8), GOLD, px, 0.42, pz);
        this.add(P, new THREE.SphereGeometry(0.07, 8, 6), GOLD, px, 0.84, pz);
      }
      for (let i = 1; i < pali.length; i++) this.add(P, arch(pali[i - 1], pali[i], 0.77, 0.55, 0.035, pz), 0xb02a3a);
    }
  }
  /** Livello 6: corona d'oro con le gemme rosa, figlia di Ginni (saltella con lei). */
  private coronaGinni() {
    // anello aperto (oro sulle due facce) posato sulla testa, inclinato in avanti; dentro spunta lo chignon
    const K = new THREE.Group(); K.position.set(0, 2.12, -0.08); K.rotation.x = 0.22; this.corona.add(K);
    const oro = GOLD.clone(); oro.side = THREE.DoubleSide;
    const GEMMA = 0xe57f9d;
    this.add(K, new THREE.CylinderGeometry(0.3, 0.26, 0.2, 14, 1, true), oro, 0, 0, 0, { cast: false });
    for (let k = 0; k < 6; k++) {
      const a = k / 6 * Math.PI * 2, x = Math.sin(a) * 0.29, z = Math.cos(a) * 0.29;
      this.add(K, new THREE.ConeGeometry(0.075, 0.2, 6), oro, x, 0.2, z, { cast: false });
      this.add(K, new THREE.SphereGeometry(0.045, 8, 6), GEMMA, x, 0.32, z, { cast: false });
    }
    this.add(K, new THREE.SphereGeometry(0.065, 8, 6), GEMMA, 0, 0, 0.29, { cast: false });
  }
  /** Scintille dorate che salgono da Ginni per 1,5 s (una InstancedMesh, una draw call) e, se c'e', il testo dorato.
   *  Con prefers-reduced-motion solo il testo. */
  festa(testo?: string) {
    this.sveglia();
    if (testo) { const a = this.floatText(testo, new V3(GINNI.x, 3.3, GINNI.z), 'v-gold v-festa', 2300); a.free = false; }
    if (this.reduce || this.disposed) return;
    // la nuvola cresce con lo zoom (sul telefono l'isola intera sta in 70 unita'): resta visibile a ogni distanza
    const N = 26, R = rngFor('festa' + performance.now()), zoom = Math.max(1, this.viewH / 30);
    // stellina a quattro punte, girata verso la camera a ogni fotogramma
    const st = new THREE.Shape();
    for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2, r = i % 2 ? 0.07 : 0.26; if (i) st.lineTo(Math.sin(a) * r, Math.cos(a) * r); else st.moveTo(0, r); }
    const geo = new THREE.ShapeGeometry(st);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false });
    const inst = new THREE.InstancedMesh(geo, mat, N);
    // le scintille escono dalla sfera di partenza: senza questo three le taglierebbe col bounding del primo fotogramma
    inst.frustumCulled = false;
    const ORI = [0xffd86b, 0xfff4c2, 0xf2b84b], col = new THREE.Color();
    const S = Array.from({ length: N }, (_, i) => {
      inst.setColorAt(i, col.setHex(ORI[i % ORI.length]));
      return { a: i / N * 6.283 + R() * 0.4, r: 0.35 + R() * 0.6, su: 2.4 + R() * 2.2, giro: 1.5 + R() * 2.5, ritardo: R() * 0.3, s: 0.6 + R() * 0.8 };
    });
    inst.position.copy(GINNI); inst.scale.setScalar(zoom);
    this.scene.add(inst);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), qz = new THREE.Quaternion(), Z = new V3(0, 0, 1), s3 = new V3(), p3 = new V3();
    const tw = this.tween(1500, (p) => {
      S.forEach((k, i) => {
        // partenza dal petto di Ginni a ogni zoom, poi la salita e l'allargarsi in scala
        const t = Math.max(0, Math.min(1, (p - k.ritardo) / (1 - k.ritardo))), an = k.a + t * k.giro, rr = k.r / zoom + t * 0.9;
        p3.set(Math.cos(an) * rr, 1.0 / zoom + t * k.su, Math.sin(an) * rr);
        q.copy(this.camera.quaternion).multiply(qz.setFromAxisAngle(Z, t * 5 + i));
        s3.setScalar(t > 0 ? k.s * (1 - t * 0.6) * (0.75 + 0.25 * Math.sin(t * 30 + i)) : 0);
        inst.setMatrixAt(i, m4.compose(p3, q, s3));
      });
      inst.instanceMatrix.needsUpdate = true;
      mat.opacity = p < 0.7 ? 1 : 1 - (p - 0.7) / 0.3;
    }, () => { this.scene.remove(inst); inst.dispose(); geo.dispose(); mat.dispose(); });
    tw.ombre = false;
  }
  /** "+n" dorato sopra Ginni (paillettes appena prese). Punto delle migliaia anche a 4 cifre ("+1.240"): toLocaleString
   *  in italiano lo mette solo da 10.000. */
  puntiFlottanti(n: number) {
    this.floatText('+' + String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.'), new V3(GINNI.x, 2.8, GINNI.z), 'v-gold');
    this.sveglia();
  }

  /* ---------- tocchi: trascina, pizzica, tocca ---------- */
  private bindPointer() {
    const c = this.canvas;
    const down = (e: PointerEvent) => { this.sveglia(); c.setPointerCapture(e.pointerId); this.ptr.set(e.pointerId, { x: e.clientX, y: e.clientY }); if (this.ptr.size === 1) this.moved = 0; else this.pinch = 0; };
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
    const wheel = (e: WheelEvent) => { e.preventDefault(); this.zoomBy(e.deltaY > 0 ? 1.1 : 1 / 1.1); this.sveglia(); };
    c.addEventListener('pointerdown', down); c.addEventListener('pointermove', move); c.addEventListener('pointerup', end); c.addEventListener('pointercancel', end);
    c.addEventListener('wheel', wheel, { passive: false });
    this.off.push(() => { c.removeEventListener('pointerdown', down); c.removeEventListener('pointermove', move); c.removeEventListener('pointerup', end); c.removeEventListener('pointercancel', end); c.removeEventListener('wheel', wheel); });
  }
  /** Tocco sul canvas. Restituisce false se non ha preso niente (la pagina lo usa per chiudere il pannello). */
  onTap: ((hit: boolean) => void) | null = null;
  private pick(x: number, y: number) {
    const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(x / innerWidth * 2 - 1, -(y / innerHeight) * 2 + 1);
    ray.setFromCamera(ndc, this.camera);
    // con un pannello aperto il tocco lo chiude; dal Magazzino (o dalla scheda di una pila) si puo' toccare una pila
    const soloPile = !!this.ctx && (this.ctx.type === 'wh' || this.ctx.type === 'pila');
    if (this.ctx && !soloPile) { this.onTap?.(false); return; }
    for (const h of ray.intersectObjects([...this.pickables, this.ginni], true)) {
      let o: THREE.Object3D | null = h.object;
      while (o && !o.userData.kind) o = o.parent;
      if (!o) continue;
      const k = o.userData.kind;
      if (k === 'pile' || k === 'avviso') {
        const key: string | undefined = k === 'pile' ? o.userData.key : o.userData.keys?.[h.instanceId ?? -1];
        if (!key) continue;
        this.mostraPila(key); this.ev.onPila?.(key);
        return;
      }
      if (soloPile) break;
      if (k === 'lab') { this.ev.onLab(o.userData.key); return; }
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
    this.clampTarget(); this.placeCam(); this.dirty = true;
  }
  private zoomBy(f: number) { this.viewH = Math.min(80, Math.max(8, this.viewH * f)); this.resize(); }

  /* ---------- ciclo ---------- */
  private v3 = new V3();
  private frameTick(now: number) {
    const vivo = !this.reduce && now - this.ultimoInput < RIPOSO_MS;
    if (vivo) this.fermo = false;
    else if (!this.fermo) { this.posa(); this.fermo = true; this.dirty = true; }
    const attivo = this.tweens.length > 0 || this.ptr.size > 0 || this.dirty;
    if (!attivo && (!vivo || now - this.lastRender < 33)) {
      // niente da disegnare: solo le etichette a tempo (pila appena arrivata), 4 volte al secondo
      if (now - this.lastLabels > 250) { this.lastLabels = now; this.updateLabels(now); }
      return;
    }
    this.lastRender = now; this.lastLabels = now; this.dirty = false;
    // le ombre seguono gli oggetti che si muovono (furgoncino, pile), non la camera
    if (this.shadowDirty || this.tweens.some((tw) => tw.ombre !== false)) { this.renderer.shadowMap.needsUpdate = true; this.shadowDirty = false; }
    for (let i = this.tweens.length - 1; i >= 0; i--) {
      const tw = this.tweens[i];
      if (tw.dead) { this.tweens.splice(i, 1); continue; }
      const p = Math.min(1, (now - tw.t0) / tw.dur);
      tw.fn(p);
      if (p >= 1) { this.tweens.splice(i, 1); tw.done?.(); }
    }
    const t = now / 1000;
    if (vivo) {
      this.ginni.position.y = Math.abs(Math.sin(t * 2.2)) * 0.06;
      this.foam.scale.setScalar(1 + Math.sin(t * 0.8) * 0.004);
      if (this.pallone) { this.pallone.position.y = PALLONE.y + Math.sin(t * 0.8) * 0.35; this.pallone.rotation.y = Math.sin(t * 0.25) * 0.3; }
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
    this.passoMeteo(now, vivo);
    this.updateLabels(now);
    this.renderer.render(this.scene, this.camera);
  }
  /** Posa del riposo: niente fumo, braccia giu', Ginni a terra, mongolfiera ferma. */
  private posa() {
    this.ginni.position.y = 0; this.foam.scale.setScalar(1);
    if (this.pallone) { this.pallone.position.y = PALLONE.y; this.pallone.rotation.y = 0; }
    for (const L of this.labs.values()) {
      L.puffs.forEach((pf) => { (pf.material as THREE.MeshLambertMaterial).opacity = 0; });
      (L.ch.userData.arm as THREE.Group).rotation.x = 0;
    }
  }
  /** Fonde le mesh FERME di `root` che hanno lo stesso materiale e le stesse ombre in una mesh sola: la scena da ferma
   *  faceva ~1.250 draw call; fondendo decori, staccionata, erba, sassi e gusci di magazzino e capannoni scendono a
   *  ~930 (misurato il 16-10 sui dati veri). Il resto sono le pile del magazzino e i carrelli, saltati di proposito
   *  perche' si ricostruiscono a ogni aggiorna() e saltano all'arrivo. `salta`: i
   *  sottogruppi che si muovono o si ricostruiscono (personaggi, fumo, carrelli, pile). Il raycast funziona uguale: la
   *  mesh fusa e' figlia di `root`, che porta userData.kind. */
  private impasta(root: THREE.Object3D, salta: THREE.Object3D[] = []) {
    root.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(root.matrixWorld).invert(), mtx = new THREE.Matrix4();
    const fuori = new Set(salta), secchi = new Map<string, THREE.Mesh[]>();
    const visita = (o: THREE.Object3D) => {
      if (fuori.has(o)) return;
      const m = o as THREE.Mesh;
      if (m.isMesh && !(m as THREE.InstancedMesh).isInstancedMesh && !m.children.length && !Array.isArray(m.material) && !m.material.transparent && !m.geometry.morphAttributes.position) {
        const g = m.geometry;
        const k = [m.material.uuid, m.castShadow, m.receiveShadow, g.index ? 'i' : 'n', Object.keys(g.attributes).sort().join(',')].join('|');
        const a = secchi.get(k); if (a) a.push(m); else secchi.set(k, [m]);
      }
      for (const c of [...o.children]) visita(c);
    };
    for (const c of [...root.children]) visita(c);
    const tolte = new Set<THREE.BufferGeometry>();
    for (const ms of secchi.values()) {
      if (ms.length < 2) continue;
      const geos = ms.map((m) => m.geometry.clone().applyMatrix4(mtx.multiplyMatrices(inv, m.matrixWorld)));
      const fusa = mergeGeometries(geos, false);
      geos.forEach((g) => g.dispose());
      if (!fusa) continue;
      const mesh = new THREE.Mesh(fusa, ms[0].material);
      mesh.castShadow = ms[0].castShadow; mesh.receiveShadow = ms[0].receiveShadow;
      root.add(mesh);
      for (const m of ms) { tolte.add(m.geometry); m.parent?.remove(m); }
    }
    // gruppi rimasti vuoti (alberi, cespugli), senza scendere nelle parti saltate (i loro slot vuoti servono), e
    // geometrie che nessuna mesh usa piu'
    const vuoti: THREE.Object3D[] = [];
    const cerca = (o: THREE.Object3D) => {
      if (fuori.has(o)) return;
      if (!(o as THREE.Mesh).isMesh && !o.children.length) vuoti.push(o);
      for (const c of o.children) cerca(c);
    };
    for (const c of root.children) cerca(c);
    vuoti.forEach((o) => o.parent?.remove(o));
    root.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) tolte.delete(m.geometry); });
    tolte.forEach((g) => { if (!SHARED.has(g) && !this.keep.has(g)) g.dispose(); });
  }
  private updateLabels(now: number) {
    const w = innerWidth, h = innerHeight;
    // in verticale l'HUD va a capo e copre tutta la fascia in alto; in orizzontale e' una riga col centro libero, quindi
    // si nasconde solo l'etichetta che finirebbe sotto una pillola (a 1024x768 quella delle Paillettes copriva il Magazzino)
    const hudB = this.portrait && this.hudEl ? this.hudEl.offsetHeight + 4 : 0;
    const pillole = !this.portrait && this.hudEl ? [...this.hudEl.children].map((c) => c.getBoundingClientRect()).filter((r) => r.width > 0) : [];
    for (const a of this.anchors) {
      let show = !!(a.cond ? a.cond(now) : true);
      let x = 0, y = 0;
      if (show) {
        this.v3.copy(a.pos).project(this.camera);
        x = (this.v3.x + 1) / 2 * w; y = (1 - this.v3.y) / 2 * h;
        if (!a.free && (this.v3.x < -1.05 || this.v3.x > 1.05 || this.v3.y < -1.05 || this.v3.y > 1.02 || y < hudB + 30)) show = false;
      }
      if (show && !a.free) {
        // misurata da visibile (nascosta darebbe 0); w = 0 dopo un cambio di testo la fa rimisurare
        if (!a.w) { a.el.hidden = false; a.w = a.el.offsetWidth; a.h = a.el.offsetHeight; }
        const half = a.w / 2 + 8;
        x = Math.max(half, Math.min(w - half, x));
        // il riquadro sta sopra il punto, la punta scende di 11 px: 4 px di aria intorno
        const l = x - a.w / 2 - 4, r = x + a.w / 2 + 4, t = y - (a.h ?? 0) - 4, b = y + 15;
        if (pillole.some((p) => l < p.right && r > p.left && t < p.bottom && b > p.top)) show = false;
      }
      if (a.el.hidden === show) a.el.hidden = !show;
      if (!show) continue;
      a.el.style.transform = 'translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px) translate(-50%,-100%)';
    }
  }
}

