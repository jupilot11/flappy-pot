import { Game, type GameState } from './game/game';
import { store } from './game/storage';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const frame = $('frame');
const stage = $('stage');
const canvas = $<HTMLCanvasElement>('game');
const scoreEl = $('score');
const tipsEl = $('tips');
const tipsPill = document.querySelector<HTMLElement>('.tips-pill')!;
const overEl = $('over');

function pulse(el: HTMLElement, cls: string): void {
  el.classList.remove(cls);
  void el.offsetWidth; // restart the CSS animation
  el.classList.add(cls);
}

const game = new Game(canvas, {
  onState(s: GameState) {
    stage.dataset.state = s;
    if (s === 'play') stage.dataset.first = '0';
    // Put keyboard / screen-reader focus on the card's action so its title and result are announced.
    if (s === 'over') $('btn-again').focus({ preventScroll: true });
    if (s === 'paused') $('btn-resume').focus({ preventScroll: true });
  },
  onScore(n) {
    scoreEl.textContent = String(n);
    if (n > 0) pulse(scoreEl, 'pop');
  },
  onTips(n) {
    tipsEl.textContent = String(n);
    if (n > 0) pulse(tipsPill, 'bump');
  },
  onOver(s) {
    $('final-score').textContent = String(s.score);
    $('final-best').textContent = String(s.best);
    $('final-tips').textContent = String(s.tips);
    $('rank').textContent = s.rank;
    $('over-title').textContent = s.headline;
    $('next-rank').textContent = s.next ? `${s.next.need} more for ${s.next.rank}` : 'Top of the kitchen';
    renderJar();
    overEl.classList.toggle('is-best', s.newBest && s.score > 0);
  },
});

$('best-start').textContent = String(game.getBest());

function renderJar(): void {
  const total = String(store.getTotalTips());
  document.querySelectorAll('.jar').forEach((el) => (el.textContent = total));
}
renderJar();

/* ───────────── responsive layout ───────────── */

function layout(): void {
  const vv = window.visualViewport;
  const vw = Math.round(vv?.width ?? window.innerWidth);
  const vh = Math.round(vv?.height ?? window.innerHeight);

  // Wide screens get a phone-shaped bezel; phones go edge to edge.
  // (landscape phones and other short screens stay full-bleed so the game isn't shrunk into a sliver)
  const framed = vh >= 500 && (vw >= 700 || (vw >= 520 && vw / vh > 0.72));
  let fw = vw;
  let fh = vh;
  if (framed) {
    fh = Math.min(vh - 32, 900);
    fw = Math.min(Math.round((fh * 9) / 16), vw - 32);
  }
  frame.classList.toggle('framed', framed);
  frame.style.width = `${fw}px`;
  frame.style.height = `${fh}px`;

  const rect = stage.getBoundingClientRect();
  void game.resize(rect.width, rect.height, Math.min(window.devicePixelRatio || 1, 3));
  // Scale UI by the playfield width, not the stage: in landscape the canvas is a narrow column.
  const u = Math.min(1.4, Math.max(0.85, canvas.getBoundingClientRect().width / 390));
  stage.style.setProperty('--u', u.toFixed(3));
}

let resizeTimer = 0;
function scheduleLayout(): void {
  window.clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(layout, 80);
}
window.addEventListener('resize', scheduleLayout);
window.visualViewport?.addEventListener('resize', scheduleLayout);
window.addEventListener('orientationchange', scheduleLayout);

/* ───────────── input ───────────── */

function act(): void {
  game.sfx.unlock();
  switch (game.getState()) {
    case 'ready':
    case 'play':
      game.flap();
      break;
    case 'over':
      if (game.sinceOver() > 600) game.reset();
      break;
    default:
      break;
  }
}

// One handler covers mouse, touch and pen.
stage.addEventListener('pointerdown', (e) => {
  if ((e.target as HTMLElement).closest('button')) return;
  e.preventDefault();
  act();
});

window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') {
    e.preventDefault();
    const active = document.activeElement;
    if (active instanceof HTMLElement && active.tagName === 'BUTTON') active.blur();
    if (game.getState() === 'paused') game.resume();
    else act();
  } else if (e.code === 'KeyP' || e.code === 'Escape') {
    if (game.getState() === 'paused') game.resume();
    else game.pause();
  } else if (e.code === 'KeyM') {
    toggleMute();
  }
});

$('btn-start').addEventListener('click', () => {
  game.sfx.unlock();
  game.flap();
});
$('btn-again').addEventListener('click', () => {
  game.sfx.unlock();
  game.reset();
});
$('btn-resume').addEventListener('click', () => game.resume());
$('btn-pause').addEventListener('click', (e) => {
  (e.currentTarget as HTMLElement).blur();
  if (game.getState() === 'paused') game.resume();
  else game.pause();
});

const muteBtn = $('btn-mute');
function syncMute(): void {
  muteBtn.setAttribute('aria-pressed', String(game.sfx.muted));
  muteBtn.setAttribute('aria-label', game.sfx.muted ? 'Unmute sound' : 'Mute sound');
}
function toggleMute(): void {
  game.sfx.unlock();
  game.sfx.setMuted(!game.sfx.muted);
  syncMute();
}
muteBtn.addEventListener('click', (e) => {
  (e.currentTarget as HTMLElement).blur();
  toggleMute();
});
syncMute();

// Never let the pot fall while the tab is hidden.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) game.pause();
});
window.addEventListener('blur', () => game.pause());

/* ───────────── go ───────────── */

layout();
game.run();
