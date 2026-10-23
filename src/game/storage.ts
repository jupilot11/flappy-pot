/** localStorage wrapper that never throws (private mode, blocked storage, sandboxed iframes). */
const KEY = 'flappy-pot:v1';

interface Saved {
  best: number;
  totalTips: number;
  muted: boolean;
}

const DEFAULTS: Saved = { best: 0, totalTips: 0, muted: false };

function read(): Saved {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Saved>) };
  } catch {
    /* ignore */
  }
  return { ...DEFAULTS };
}

let cache = read();

function write(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    /* ignore */
  }
}

export const store = {
  getBest: () => cache.best,
  setBest(n: number) {
    cache.best = n;
    write();
  },
  getTotalTips: () => cache.totalTips,
  addTips(n: number) {
    cache.totalTips += n;
    write();
  },
  getMuted: () => cache.muted,
  setMuted(m: boolean) {
    cache.muted = m;
    write();
  },
};
