import { store } from './storage';

/** Tiny synthesised sound effects (Web Audio) so the game ships with zero audio files. */
export class Sfx {
  private ctx?: AudioContext;
  muted = store.getMuted();

  /** Must be called from a user gesture (first tap / key press). */
  unlock(): void {
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  setMuted(m: boolean): void {
    this.muted = m;
    store.setMuted(m);
  }

  private tone(freq: number, dur: number, type: OscillatorType, vol: number, slideTo?: number, delay = 0): void {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
  }

  private noise(dur: number, vol: number): void {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 900;
    gain.gain.value = vol;
    src.buffer = buf;
    src.connect(filter).connect(gain).connect(ctx.destination);
    src.start();
  }

  flap(): void {
    this.tone(380, 0.11, 'triangle', 0.16, 640);
  }
  score(): void {
    this.tone(880, 0.09, 'sine', 0.14);
    this.tone(1320, 0.14, 'sine', 0.12, undefined, 0.07);
  }
  coin(): void {
    this.tone(1175, 0.08, 'square', 0.07);
    this.tone(1568, 0.16, 'square', 0.07, undefined, 0.07);
  }
  hit(): void {
    this.noise(0.28, 0.5);
    this.tone(180, 0.28, 'sawtooth', 0.14, 50);
  }
  best(): void {
    [660, 880, 1100, 1320].forEach((f, i) => this.tone(f, 0.16, 'triangle', 0.13, undefined, i * 0.09));
  }
}
