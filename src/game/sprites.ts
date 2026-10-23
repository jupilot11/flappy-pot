import potBody from '../assets/pot-body.svg?raw';
import potLid from '../assets/pot-lid.svg?raw';
import flame from '../assets/flame.svg?raw';
import puff from '../assets/steam-puff.svg?raw';
import coin from '../assets/coin.svg?raw';
import cloud from '../assets/cloud.svg?raw';
import spoonShaft from '../assets/spoon-shaft.svg?raw';
import spoonHead from '../assets/spoon-head.svg?raw';
import spatulaShaft from '../assets/spatula-shaft.svg?raw';
import spatulaHead from '../assets/spatula-head.svg?raw';
import groundTile from '../assets/ground-tile.svg?raw';
import skyline from '../assets/skyline.svg?raw';

/** Logical (game-unit) size of each sprite. SVGs are rasterised at exactly this size × screen scale. */
const DEFS = {
  potBody: { raw: potBody, w: 60, h: 27 },
  potLid: { raw: potLid, w: 54, h: 21 },
  flame: { raw: flame, w: 14, h: 20.3 },
  puff: { raw: puff, w: 24, h: 18 },
  coin: { raw: coin, w: 26, h: 26 },
  cloud: { raw: cloud, w: 96, h: 42 },
  spoonShaft: { raw: spoonShaft, w: 28, h: 8 },
  spoonHead: { raw: spoonHead, w: 52, h: 46 },
  spatulaShaft: { raw: spatulaShaft, w: 28, h: 8 },
  spatulaHead: { raw: spatulaHead, w: 52, h: 54 },
  groundTile: { raw: groundTile, w: 48, h: 48 },
  skyline: { raw: skyline, w: 360, h: 120 },
} as const;

export type SpriteName = keyof typeof DEFS;

export interface Sprite {
  /** Pre-rasterised bitmap, 1 image px = 1 device px. */
  c: HTMLCanvasElement;
  /** Size in game units that maps exactly onto the bitmap (keeps edges pixel-aligned). */
  w: number;
  h: number;
}

export type SpriteSheet = Record<SpriteName, Sprite>;

function sizeSvg(raw: string, pw: number, ph: number): string {
  return raw.replace(/<svg([^>]*)>/, (_m, attrs: string) => {
    const clean = attrs.replace(/\s(width|height)="[^"]*"/g, '');
    return `<svg${clean} width="${pw}" height="${ph}">`;
  });
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('sprite failed to load'));
    img.src = url;
  });
}

async function bake(raw: string, lw: number, lh: number, scale: number): Promise<Sprite> {
  const pw = Math.max(1, Math.round(lw * scale));
  const ph = Math.max(1, Math.round(lh * scale));
  const url = URL.createObjectURL(new Blob([sizeSvg(raw, pw, ph)], { type: 'image/svg+xml' }));
  try {
    const img = await loadImage(url);
    const c = document.createElement('canvas');
    c.width = pw;
    c.height = ph;
    c.getContext('2d')!.drawImage(img, 0, 0, pw, ph);
    return { c, w: pw / scale, h: ph / scale };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Rasterise every sprite at `scale` device-pixels per game unit. */
export async function bakeAll(scale: number): Promise<SpriteSheet> {
  const names = Object.keys(DEFS) as SpriteName[];
  const baked = await Promise.all(names.map((n) => bake(DEFS[n].raw, DEFS[n].w, DEFS[n].h, scale)));
  const sheet = {} as SpriteSheet;
  names.forEach((n, i) => (sheet[n] = baked[i]));
  return sheet;
}
