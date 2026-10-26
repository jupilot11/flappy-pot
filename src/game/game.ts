import { bakeAll, type SpriteSheet } from './sprites';
import { Sfx } from './audio';
import { store } from './storage';

/* ───────────────────────── constants (all in "game units") ───────────────────────── */

/** The world flexes with the screen: tall phones get more sky, landscape screens see further ahead. */
const MIN_W = 360;
const MAX_W = 1200;
const MIN_H = 540;
const MAX_H = 860;

const GROUND_H = 84;
const EDGE_H = 8;

const GRAVITY = 1750;
const FLAP_V = -500;
const MAX_FALL = 760;

const POT_X = 96;
/** Pot hit box, relative to the pot body centre. Generous on purpose. */
const HB = { l: -21, r: 21, t: -24, b: 11 };

const OB_W = 52;
const SHAFT_X = 12;
const SHAFT_W = 28;
const HEAD_H = [46, 54] as const;
const SPACING = 208;

const COLORS = {
  ink: '#1F1715',
  orange: '#E84C1E',
  flame: '#FF8A3D',
  flameCore: '#FFD27A',
  coin: '#FFC53D',
  steam: '#F8C4AE',
  white: '#FFFFFF',
};

/* ───────────────────────── types ───────────────────────── */

export type GameState = 'ready' | 'play' | 'dying' | 'over' | 'paused';

export interface OverSummary {
  score: number;
  best: number;
  tips: number;
  newBest: boolean;
  rank: string;
  /** Game-over headline, escalating with the rank. */
  headline: string;
  /** Next rank up and the points still needed, or null at the top. */
  next: { rank: string; need: number } | null;
}

export interface Hooks {
  onState(s: GameState): void;
  onScore(n: number): void;
  onTips(n: number): void;
  onOver(s: OverSummary): void;
}

interface Obstacle {
  x: number;
  gapY: number;
  gap: number;
  kind: 0 | 1;
  scored: boolean;
  coin: { y: number; taken: boolean; phase: number } | null;
}

interface Particle {
  kind: 'puff' | 'dot';
  x: number;
  y: number;
  vx: number;
  vy: number;
  grav: number;
  life: number;
  max: number;
  size: number;
  color: string;
}

interface Cloud {
  x: number;
  y: number;
  s: number;
  v: number;
}

/* ───────────────────────── helpers ───────────────────────── */

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);

/** Kitchen ladder, lowest first: [min score, rank, game-over headline]. */
const RANKS: readonly [number, string, string][] = [
  [0, 'Dishwasher', 'Order’s Burnt!'],
  [2, 'Line Cook', 'Undercooked!'],
  [5, 'Sous Chef', 'Not Bad, Chef!'],
  [10, 'Head Chef', 'Order Up!'],
  [20, 'Executive Chef', 'Chef’s Kiss!'],
  [35, 'Michelin Star', 'Three Stars!'],
];

function rankFor(score: number): Pick<OverSummary, 'rank' | 'headline' | 'next'> {
  let i = 0;
  while (i + 1 < RANKS.length && score >= RANKS[i + 1][0]) i++;
  const up = RANKS[i + 1];
  return { rank: RANKS[i][1], headline: RANKS[i][2], next: up ? { rank: up[1], need: up[0] - score } : null };
}

function overlap(al: number, at: number, ar: number, ab: number, bl: number, bt: number, br: number, bb: number): boolean {
  return al < br && ar > bl && at < bb && ab > bt;
}

/* ───────────────────────── game ───────────────────────── */

export class Game {
  readonly sfx = new Sfx();

  private ctx: CanvasRenderingContext2D;
  private sp?: SpriteSheet;
  private spScale = 0;
  private bg?: HTMLCanvasElement;
  private resizeToken = 0;

  private W = MIN_W;
  private H = 640;
  private S = 1; // device pixels per game unit
  private potX = POT_X;

  private state: GameState = 'ready';
  private time = 0;
  private worldX = 0;
  private freezeT = 0;

  private pot = { y: 0, vy: 0, rot: 0 };
  private lidPop = 0;
  private lidDir: 1 | -1 = 1;
  private flameBoost = 0;
  private steamT = 0;

  /** The lid pops off on a crash and bounces to rest on the counter. */
  private lid = { active: false, x: 0, y: 0, vx: 0, vy: 0, rot: 0, vr: 0, resting: false };

  private obstacles: Obstacle[] = [];
  private particles: Particle[] = [];
  private clouds: Cloud[] = [];

  private score = 0;
  private tips = 0;
  private best = store.getBest();

  private shake = 0;
  private flash = 0;
  private dyingT = 0;
  private landedT = 0;
  private landed = false;
  private overAt = 0;
  private pausedFrom: GameState = 'play';

  private raf = 0;
  private last = 0;
  private readonly reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  constructor(private canvas: HTMLCanvasElement, private hooks: Hooks) {
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.pot.y = this.readyY();
    for (let i = 0; i < 5; i++) {
      this.clouds.push({ x: rand(0, this.W), y: rand(50, this.H * 0.42), s: rand(0.55, 1), v: rand(7, 16) });
    }
  }

  /* ───────────── public API ───────────── */

  getState(): GameState {
    return this.state;
  }

  getBest(): number {
    return this.best;
  }

  /** Milliseconds since the game-over card appeared (used to ignore accidental taps). */
  sinceOver(): number {
    return performance.now() - this.overAt;
  }

  async resize(stageW: number, stageH: number, dpr: number): Promise<void> {
    const token = ++this.resizeToken;

    let newH = clamp((MIN_W * stageH) / stageW, MIN_H, MAX_H);
    // Don't shift the playfield under the player's feet because a mobile URL bar collapsed.
    if ((this.state === 'play' || this.state === 'dying') && Math.abs(newH - this.H) < 160) newH = this.H;
    let newW = clamp((newH * stageW) / stageH, MIN_W, MAX_W);
    // Mid-run the pot can't slide sideways into a utensil; a new width waits for the next reset().
    if (this.state !== 'ready') newW = this.W;

    const scale = Math.min(stageW / newW, stageH / newH);
    const S = scale * dpr;

    const oldH = this.H;
    const oldW = this.W;
    this.H = newH;
    this.W = newW;
    this.S = S;
    if (oldH !== newH) this.rescaleWorld(oldH, newH);
    if (oldW !== newW) {
      // Pushed right on wide screens so it clears landscape notches and the HUD keeps its distance.
      this.potX = POT_X + (newW - MIN_W) * 0.22;
      for (const c of this.clouds) c.x *= newW / oldW;
    }

    this.canvas.style.width = `${this.W * scale}px`;
    this.canvas.style.height = `${newH * scale}px`;
    this.canvas.width = Math.max(1, Math.round(this.W * S));
    this.canvas.height = Math.max(1, Math.round(newH * S));

    if (!this.sp || Math.abs(S - this.spScale) / S > 0.02) {
      let sheet: SpriteSheet | undefined;
      try {
        sheet = await bakeAll(S);
      } catch (err) {
        // With no sprites at all the game can't draw; otherwise the old ones still work, just less crisp.
        if (!this.sp) throw err;
      }
      if (token !== this.resizeToken) return; // a newer resize superseded this one
      if (sheet) {
        this.sp = sheet;
        this.spScale = S;
      }
    }
    this.buildBackground();
    if (this.state === 'paused') this.render(); // resizing cleared the canvas and the loop is stopped
  }

  run(): void {
    this.last = performance.now();
    const tick = (t: number) => {
      const dt = Math.min(0.04, Math.max(0, (t - this.last) / 1000));
      this.last = t;
      if (this.sp && this.bg) {
        if (this.state !== 'paused') this.update(dt);
        this.render();
        // Paused frames are static: stop the loop (resume() restarts it) so idle tabs don't burn battery.
        if (this.state === 'paused') {
          this.raf = 0;
          return;
        }
      }
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
  }

  /** Flap. From the ready state this also starts the run. */
  flap(): void {
    if (this.state === 'ready') this.begin();
    if (this.state !== 'play' || this.freezeT > 0) return;
    this.pot.vy = FLAP_V;
    this.lidPop = 1;
    this.lidDir = this.lidDir === 1 ? -1 : 1;
    this.flameBoost = 1;
    this.sfx.flap();
    const [lx, ly] = this.lidPos();
    this.emitPuff(lx - 7, ly);
    this.emitPuff(lx + 7, ly + 2);
  }

  reset(): void {
    this.state = 'ready';
    this.score = 0;
    this.tips = 0;
    this.obstacles = [];
    this.particles = [];
    this.pot = { y: this.readyY(), vy: 0, rot: 0 };
    this.lid.active = false;
    this.lidPop = 0;
    this.flameBoost = 0;
    this.shake = 0;
    this.flash = 0;
    this.landed = false;
    this.landedT = 0;
    this.dyingT = 0;
    this.freezeT = 0;
    this.hooks.onScore(0);
    this.hooks.onTips(0);
    this.hooks.onState('ready');
  }

  pause(): void {
    if (this.state !== 'play') return;
    this.pausedFrom = this.state;
    this.state = 'paused';
    this.hooks.onState('paused');
  }

  resume(): void {
    if (this.state !== 'paused') return;
    this.state = this.pausedFrom;
    this.freezeT = 0.6; // brief breather so the pot doesn't instantly fall
    this.hooks.onState(this.state);
    if (!this.raf) this.run();
  }

  /* ───────────── world helpers ───────────── */

  private groundTop(): number {
    return this.H - GROUND_H;
  }

  private readyY(): number {
    return this.H * 0.72;
  }

  private speed(): number {
    return 140 + Math.min(this.score, 40) * 1.5;
  }

  private gapSize(): number {
    return 172 - Math.min(this.score, 30);
  }

  private rescaleWorld(oldH: number, newH: number): void {
    const k = newH / oldH;
    this.pot.y *= k;
    for (const o of this.obstacles) {
      o.gapY *= k;
      if (o.coin) o.coin.y *= k;
    }
    for (const c of this.clouds) c.y *= k;
  }

  private lidPos(): [number, number] {
    const { rot, y } = this.pot;
    return [this.potX + 33 * Math.sin(rot), y - 33 * Math.cos(rot)];
  }

  private begin(): void {
    this.state = 'play';
    this.score = 0;
    this.tips = 0;
    this.obstacles = [];
    this.pot.vy = 0;
    this.worldX = 0;
    this.spawn(this.potX + 414, this.pot.y);
    // Wide screens: fill the visible stretch at the usual spacing instead of leaving it empty.
    for (let x = this.potX + 414 + SPACING; x <= this.W + 20; x += SPACING) this.spawn(x);
    this.hooks.onScore(0);
    this.hooks.onTips(0);
    this.hooks.onState('play');
  }

  private spawn(x: number, forcedCenter?: number): void {
    const gap = this.gapSize();
    const lo = 76 + gap / 2;
    const hi = this.groundTop() - 76 - gap / 2;
    const prev = this.obstacles[this.obstacles.length - 1];
    let c = forcedCenter ?? rand(lo, hi);
    // Keep consecutive gaps reachable.
    if (prev && forcedCenter === undefined) c = clamp(c, prev.gapY - 190, prev.gapY + 190);
    c = clamp(c, lo, hi);

    const hasCoin = this.obstacles.length > 0 && Math.random() < 0.62;
    this.obstacles.push({
      x,
      gapY: c,
      gap,
      kind: Math.random() < 0.5 ? 0 : 1,
      scored: false,
      coin: hasCoin ? { y: c + rand(-gap * 0.2, gap * 0.2), taken: false, phase: rand(0, 6) } : null,
    });
  }

  /* ───────────── update ───────────── */

  private update(dt: number): void {
    this.time += dt;
    this.lidPop = Math.max(0, this.lidPop - dt * 3.5);
    this.flameBoost = Math.max(0, this.flameBoost - dt * 4);
    this.shake = Math.max(0, this.shake - dt);
    this.flash = Math.max(0, this.flash - dt * 3.5);

    for (const c of this.clouds) {
      c.x -= (c.v + (this.state === 'play' ? this.speed() * 0.08 : 0)) * dt;
      if (c.x < -100) {
        c.x = this.W + rand(10, 80);
        c.y = rand(50, this.H * 0.42);
      }
    }

    switch (this.state) {
      case 'ready':
        this.stepReady(dt);
        break;
      case 'play':
        this.stepPlay(dt);
        break;
      case 'dying':
        this.stepDying(dt);
        break;
      default:
        break;
    }
    this.updateLid(dt);
    this.updateParticles(dt);
  }

  private updateLid(dt: number): void {
    const l = this.lid;
    if (!l.active || l.resting) return;
    const restY = this.groundTop() - 10.5;
    l.vy += GRAVITY * 0.8 * dt;
    l.x += l.vx * dt;
    l.y += l.vy * dt;
    l.rot += l.vr * dt;
    if (l.y >= restY) {
      l.y = restY;
      if (Math.abs(l.vy) > 140) {
        l.vy = -l.vy * 0.38;
        l.vx *= 0.6;
        l.vr *= 0.5;
        this.burst(l.x, restY + 8, 4, [COLORS.steam, COLORS.white], 70, 200, -60);
      } else {
        l.resting = true;
        l.vx = l.vy = l.vr = 0;
        // settle flat, dome up
        l.rot = Math.atan2(Math.sin(l.rot), Math.cos(l.rot)) * 0.2;
      }
    }
  }

  private stepReady(dt: number): void {
    this.worldX += 70 * dt;
    this.pot.y = this.readyY() + Math.sin(this.time * 3.2) * 6;
    this.pot.rot = Math.sin(this.time * 3.2 + 1) * 0.06;
    this.steamT -= dt;
    if (this.steamT <= 0) {
      this.steamT = 0.45;
      const [lx, ly] = this.lidPos();
      this.emitPuff(lx + rand(-8, 8), ly);
    }
  }

  private stepPlay(dt: number): void {
    if (this.freezeT > 0) {
      this.freezeT -= dt;
      return;
    }
    const speed = this.speed();
    const pot = this.pot;

    pot.vy = Math.min(pot.vy + GRAVITY * dt, MAX_FALL);
    pot.y += pot.vy * dt;
    const target = clamp(pot.vy / 900, -0.45, 0.8);
    pot.rot += (target - pot.rot) * Math.min(1, dt * 12);

    // Ceiling just stops you; the ground kills you.
    if (pot.y + HB.t < 0) {
      pot.y = -HB.t;
      if (pot.vy < 0) pot.vy = 0;
    }
    if (pot.y + HB.b >= this.groundTop()) {
      pot.y = this.groundTop() - HB.b;
      this.crash(true);
      return;
    }

    this.worldX += speed * dt;

    for (const o of this.obstacles) o.x -= speed * dt;
    while (this.obstacles.length && this.obstacles[0].x < -OB_W - 12) this.obstacles.shift();
    const last = this.obstacles[this.obstacles.length - 1];
    if (!last || last.x <= this.W + 20 - SPACING) this.spawn(this.W + 20);

    for (const o of this.obstacles) {
      if (!o.scored && o.x + OB_W / 2 < this.potX) {
        o.scored = true;
        this.score++;
        this.sfx.score();
        this.hooks.onScore(this.score);
      }
      if (this.hits(o)) {
        this.crash(false);
        return;
      }
      if (o.coin && !o.coin.taken) {
        const dx = o.x + OB_W / 2 - this.potX;
        const dy = o.coin.y - (pot.y - 4);
        if (dx * dx + dy * dy < 28 * 28) {
          o.coin.taken = true;
          this.tips++;
          this.sfx.coin();
          this.hooks.onTips(this.tips);
          this.burst(o.x + OB_W / 2, o.coin.y, 9, [COLORS.coin, COLORS.flameCore, COLORS.white], 150, 0);
        }
      }
    }

    this.steamT -= dt;
    if (this.steamT <= 0) {
      this.steamT = 0.3;
      const [lx, ly] = this.lidPos();
      this.emitPuff(lx + rand(-6, 6), ly);
    }
  }

  private stepDying(dt: number): void {
    const pot = this.pot;
    this.dyingT += dt;
    if (!this.landed) {
      pot.vy = Math.min(pot.vy + GRAVITY * dt, MAX_FALL + 200);
      pot.y += pot.vy * dt;
      pot.rot += (1.25 - pot.rot) * Math.min(1, dt * 5);
      if (pot.y + HB.b >= this.groundTop()) {
        pot.y = this.groundTop() - HB.b;
        pot.vy = 0;
        this.landed = true;
        this.burst(this.potX, this.groundTop() - 2, 8, [COLORS.steam, COLORS.white], 110, 400, -120);
      }
    } else {
      this.landedT += dt;
    }
    if ((this.landed && this.landedT > 0.55) || this.dyingT > 2.5) this.finish();
  }

  private hits(o: Obstacle): boolean {
    const l = this.potX + HB.l;
    const r = this.potX + HB.r;
    const t = this.pot.y + HB.t;
    const b = this.pot.y + HB.b;
    if (r < o.x + 4 || l > o.x + OB_W - 4) return false;

    const hh = HEAD_H[o.kind];
    const topEnd = o.gapY - o.gap / 2;
    const botStart = o.gapY + o.gap / 2;
    const hl = o.x + 5;
    const hr = o.x + OB_W - 5;
    const sl = o.x + SHAFT_X + 2;
    const sr = o.x + SHAFT_X + SHAFT_W - 2;

    return (
      // top: shaft + head
      overlap(l, t, r, b, sl, -50, sr, topEnd - hh + 8) ||
      overlap(l, t, r, b, hl, topEnd - hh + 5, hr, topEnd - 2) ||
      // bottom: head + shaft
      overlap(l, t, r, b, hl, botStart + 2, hr, botStart + hh - 5) ||
      overlap(l, t, r, b, sl, botStart + hh - 8, sr, this.H + 50)
    );
  }

  private crash(ground: boolean): void {
    this.state = 'dying';
    this.sfx.hit();
    this.shake = this.reduceMotion ? 0 : 0.35;
    this.flash = this.reduceMotion ? 0 : 0.8;
    this.lidPop = 1;
    this.dyingT = 0;
    this.landedT = 0;
    this.landed = ground;
    this.pot.vy = ground ? 0 : -190;
    const [lx, ly] = this.lidPos();
    this.lid = {
      active: true,
      resting: false,
      x: lx,
      y: ly,
      vx: rand(70, 130),
      vy: ground ? -260 : -330,
      rot: this.pot.rot,
      vr: rand(5, 9) * (Math.random() < 0.5 ? -1 : 1),
    };
    this.burst(this.potX, this.pot.y, 16, [COLORS.orange, COLORS.flame, COLORS.flameCore, COLORS.ink, COLORS.white], 260, 700);
    this.hooks.onState('dying');
  }

  private finish(): void {
    const newBest = this.score > this.best;
    if (newBest) {
      this.best = this.score;
      store.setBest(this.best);
      this.sfx.best();
    }
    if (this.tips > 0) store.addTips(this.tips);
    this.overAt = performance.now();
    this.state = 'over';
    this.hooks.onOver({
      score: this.score,
      best: this.best,
      tips: this.tips,
      newBest,
      ...rankFor(this.score),
    });
    this.hooks.onState('over');
  }

  /* ───────────── particles ───────────── */

  private emitPuff(x: number, y: number): void {
    if (this.particles.length > 160) return;
    const max = rand(0.7, 1.1);
    this.particles.push({
      kind: 'puff',
      x,
      y,
      vx: rand(-38, -14),
      vy: rand(-80, -50),
      grav: 0,
      life: max,
      max,
      size: 1,
      color: '',
    });
  }

  private burst(x: number, y: number, n: number, colors: string[], speed: number, grav: number, upBias = 0): void {
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2);
      const v = rand(speed * 0.35, speed);
      const max = rand(0.4, 0.8);
      this.particles.push({
        kind: 'dot',
        x,
        y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v + upBias,
        grav,
        life: max,
        max,
        size: rand(2, 4.6),
        color: colors[(Math.random() * colors.length) | 0],
      });
    }
  }

  private updateParticles(dt: number): void {
    const ps = this.particles;
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i];
      p.life -= dt;
      if (p.life <= 0) {
        ps.splice(i, 1);
        continue;
      }
      p.vy += p.grav * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
  }

  /* ───────────── rendering ───────────── */

  private snap(v: number): number {
    return Math.round(v * this.S) / this.S;
  }

  private buildBackground(): void {
    const c = document.createElement('canvas');
    c.width = this.canvas.width;
    c.height = this.canvas.height;
    const g = c.getContext('2d')!;
    const S = this.S;
    g.setTransform(S, 0, 0, S, 0, 0);

    const grad = g.createLinearGradient(0, 0, 0, this.groundTop());
    grad.addColorStop(0, '#FFF6EF');
    grad.addColorStop(1, '#FBDCCB');
    g.fillStyle = grad;
    g.fillRect(0, 0, this.W, this.H);

    // Faint subway-tile wall.
    g.strokeStyle = 'rgba(232, 76, 30, 0.075)';
    g.lineWidth = 1.5;
    const th = 44;
    const tw = 88;
    g.beginPath();
    for (let row = 0, y = 0; y < this.H; row++, y += th) {
      g.moveTo(0, y);
      g.lineTo(this.W, y);
      const off = row % 2 ? tw / 2 : 0;
      for (let x = -off; x < this.W; x += tw) {
        if (x > 0) {
          g.moveTo(x, y);
          g.lineTo(x, y + th);
        }
      }
    }
    g.stroke();
    this.bg = c;
  }

  private render(): void {
    const ctx = this.ctx;
    const sp = this.sp!;
    const S = this.S;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.bg!, 0, 0);
    ctx.setTransform(S, 0, 0, S, 0, 0);

    if (this.shake > 0) {
      const m = this.shake * 22;
      ctx.translate((Math.random() * 2 - 1) * m, (Math.random() * 2 - 1) * m);
    }

    const gt = this.groundTop();

    // clouds
    ctx.globalAlpha = 0.85;
    for (const c of this.clouds) ctx.drawImage(sp.cloud.c, c.x, c.y, sp.cloud.w * c.s, sp.cloud.h * c.s);
    ctx.globalAlpha = 1;

    // shelf skyline (parallax)
    {
      const sk = sp.skyline;
      const off = (this.worldX * 0.28) % sk.w;
      const y = this.snap(gt - sk.h + EDGE_H + 2);
      for (let x = -off; x < this.W; x += sk.w) ctx.drawImage(sk.c, this.snap(x), y, sk.w, sk.h);
    }

    // obstacles + coins
    for (const o of this.obstacles) this.drawObstacle(o);
    for (const o of this.obstacles) {
      if (o.coin && !o.coin.taken) this.drawCoin(o.x + OB_W / 2, o.coin.y, o.coin.phase);
    }

    // ground
    {
      const tile = sp.groundTile;
      const off = this.worldX % tile.w;
      for (let ry = 0; ry < 2; ry++) {
        for (let x = -off; x < this.W; x += tile.w) {
          ctx.drawImage(tile.c, this.snap(x), this.snap(gt + EDGE_H + ry * tile.h), tile.w, tile.h);
        }
      }
      const shade = ctx.createLinearGradient(0, gt + EDGE_H, 0, gt + EDGE_H + 12);
      shade.addColorStop(0, 'rgba(31,23,21,0.22)');
      shade.addColorStop(1, 'rgba(31,23,21,0)');
      ctx.fillStyle = shade;
      ctx.fillRect(0, gt + EDGE_H, this.W, 12);
      ctx.fillStyle = COLORS.ink;
      ctx.fillRect(0, gt, this.W, EDGE_H);
      ctx.fillStyle = '#4A3C37';
      ctx.fillRect(0, gt + 1.5, this.W, 1.5);
    }

    this.drawParticles(sp);
    this.drawPot(sp);

    if (this.flash > 0) {
      ctx.setTransform(S, 0, 0, S, 0, 0);
      ctx.fillStyle = `rgba(255,255,255,${Math.min(0.6, this.flash * 0.6)})`;
      ctx.fillRect(0, 0, this.W, this.H);
    }
  }

  private drawObstacle(o: Obstacle): void {
    const ctx = this.ctx;
    const sp = this.sp!;
    const shaft = o.kind === 0 ? sp.spoonShaft : sp.spatulaShaft;
    const head = o.kind === 0 ? sp.spoonHead : sp.spatulaHead;
    const hh = HEAD_H[o.kind];
    const x = this.snap(o.x);
    const topEnd = o.gapY - o.gap / 2;
    const botStart = o.gapY + o.gap / 2;

    // top shaft (runs off the top of the screen) + head flipped so its bowl/blade faces the gap
    ctx.drawImage(shaft.c, x + SHAFT_X, -6, SHAFT_W, topEnd - hh + 8 + 6);
    ctx.save();
    ctx.translate(x, topEnd);
    ctx.scale(1, -1);
    ctx.drawImage(head.c, 0, 0, OB_W, hh);
    ctx.restore();

    // bottom head + shaft (runs into the ground)
    ctx.drawImage(head.c, x, botStart, OB_W, hh);
    ctx.drawImage(shaft.c, x + SHAFT_X, botStart + hh - 8, SHAFT_W, this.H - (botStart + hh - 8) + 6);
  }

  private drawCoin(x: number, y: number, phase: number): void {
    const ctx = this.ctx;
    const c = this.sp!.coin;
    const spin = Math.abs(Math.cos(this.time * 4 + phase));
    const w = c.w * (0.22 + 0.78 * spin);
    const bob = Math.sin(this.time * 3 + phase) * 3;
    ctx.drawImage(c.c, x - w / 2, y - c.h / 2 + bob, w, c.h);
  }

  private drawParticles(sp: SpriteSheet): void {
    const ctx = this.ctx;
    for (const p of this.particles) {
      const k = p.life / p.max;
      if (p.kind === 'puff') {
        const s = 0.5 + (1 - k) * 0.95;
        const w = sp.puff.w * s;
        const h = sp.puff.h * s;
        ctx.globalAlpha = Math.min(1, k * 1.6) * 0.75;
        ctx.drawImage(sp.puff.c, p.x - w / 2, p.y - h / 2, w, h);
      } else {
        ctx.globalAlpha = Math.min(1, k * 1.5);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (0.4 + 0.6 * k), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  private drawPot(sp: SpriteSheet): void {
    const ctx = this.ctx;
    const { y, rot } = this.pot;
    const alive = this.state === 'ready' || this.state === 'play' || this.state === 'paused';

    ctx.save();
    ctx.translate(this.potX, y);
    ctx.rotate(rot);

    // flames: they flare when you flap
    if (alive) {
      const fl = sp.flame;
      for (let i = -1; i <= 1; i++) {
        const s = (i === 0 ? 1 : 0.82) * (0.85 + 0.22 * Math.sin(this.time * 22 + i * 2.1) + this.flameBoost * 0.9);
        ctx.save();
        ctx.translate(i * 9, 12);
        ctx.scale(1, s);
        ctx.drawImage(fl.c, -fl.w / 2, 0, fl.w, fl.h);
        ctx.restore();
      }
    }

    ctx.drawImage(sp.potBody.c, -sp.potBody.w / 2, -sp.potBody.h / 2, sp.potBody.w, sp.potBody.h);

    // lid: pops and tilts on each flap, like the loader animation
    const lid = sp.potLid;
    if (alive) {
      ctx.save();
      const jig = Math.sin(this.time * 9) * 0.015;
      ctx.translate(0, -12 - this.lidPop * 5);
      ctx.rotate(this.lidDir * this.lidPop * 0.17 + jig);
      ctx.drawImage(lid.c, -lid.w / 2, -lid.h, lid.w, lid.h);
      ctx.restore();
    }

    ctx.restore();

    // after a crash the lid is its own flying/bouncing object
    if (this.lid.active) {
      ctx.save();
      ctx.translate(this.lid.x, this.lid.y);
      ctx.rotate(this.lid.rot);
      ctx.drawImage(lid.c, -lid.w / 2, -lid.h / 2, lid.w, lid.h);
      ctx.restore();
    }
  }
}
