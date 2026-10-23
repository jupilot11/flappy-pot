# Flappy Pot

A responsive, web-based flappy game starring the chef pot from the loader. You fly a steaming pot
past giant wooden spoons and orange spatulas, collecting peso-coin tips. Styled to match the food-ordering
app UI (cream + orange, Plus Jakarta Sans, pill chips, rounded cards).

**Stack:** Vite + TypeScript + plain HTML5 Canvas. No game engine, no runtime dependencies besides the font.

## Run it

```bash
npm install
npm run dev            # http://localhost:5173
npm run build          # production build -> dist/
npm run build:single   # one self-contained index.html -> dist-single/
npm run typecheck
```

## Controls

| Action | Input |
| --- | --- |
| Flap / start | Tap, click, `Space`, `↑`, `W` |
| Pause / resume | Pause button, `P` or `Esc` |
| Mute | Sound button or `M` |
| Restart (after a crash) | "Cook Again" button, or tap / `Space` after a short delay |

## How the responsiveness works

- **Fixed logical width (360), flexible height (540–780).** Tall phones get more sky instead of black bars.
- Canvas is scaled to fit the stage and rendered at `devicePixelRatio` (capped at 3) so it stays sharp.
- **SVG sprites are re-rasterised at exactly the on-screen pixel size** whenever the scale changes, then drawn
  1:1. This avoids the blurry-SVG-in-canvas problem on Safari and keeps tiling seams out of the ground and skyline.
- Phones are full-bleed; wider screens get a phone-shaped bezel (like the app screenshot). Landscape phones stay full-bleed.
- A single Pointer Events handler covers mouse, touch and pen; `touch-action: none` stops scroll/zoom on tap.
- Physics is time-based (`dt`), so it plays the same on 60 Hz and 120 Hz displays.
- Auto-pauses when the tab is hidden or loses focus. Safe-area insets are respected for notches.
- `prefers-reduced-motion` turns off screen shake, flashes and UI animations.

## Project layout

```
index.html              markup for HUD + start / hint / game-over / pause overlays
src/main.ts             input, layout (phone vs bezel), wiring DOM <-> game
src/style.css           app-style UI (tokens, cards, chips, buttons)
src/game/game.ts        game loop, physics, obstacles, coins, particles, rendering
src/game/sprites.ts     SVG -> pixel-exact canvas bitmaps
src/game/audio.ts       synthesised Web Audio sfx (no audio files)
src/game/storage.ts     best score / tips / mute in localStorage (never throws)
src/assets/*.svg        all art (see below)
```

## Assets (all SVG, hand-drawn in the loader's flat style)

| File | Used for |
| --- | --- |
| `chef-pot-loader.svg` | Your loader, shown animated on the start card (dark-mode override removed; the card is always light) |
| `pot-body.svg`, `pot-lid.svg`, `flame.svg` | The player. Lid pops on each flap, flames flare, lid flies off on a crash |
| `steam-puff.svg` | Steam particles (same 3-circle puff as the loader) |
| `spoon-shaft/head.svg`, `spatula-shaft/head.svg` | Obstacles (shafts stretch vertically; heads face the gap) |
| `coin.svg` | Peso-coin tips |
| `cloud.svg`, `skyline.svg`, `ground-tile.svg` | Parallax background: steam clouds, kitchen-shelf silhouettes, gingham counter |
| `favicon.svg` | Tab icon |

Palette comes straight from the loader: orange `#E84C1E`, ink `#1F1715`, steam `#F8C4AE`, flame `#FF8A3D` / `#FFD27A`.

## Tuning

Everything lives at the top of `src/game/game.ts`:

- `GRAVITY`, `FLAP_V`, `MAX_FALL`: feel of the flap
- `speed()` / `gapSize()`: difficulty ramp (starts at 140 px/s with a 172 px gap, caps at 200 px/s and 142 px)
- `SPACING`: distance between obstacles
- `HB`: pot hit box (deliberately forgiving)

## Ideas for later

- Global leaderboard (a single Supabase table + an RLS policy is enough)
- Installable PWA (manifest + service worker) or a Capacitor wrapper for the app stores
- More obstacle skins (ladle, rolling pin, whisk) — drop in a new shaft/head pair and add it to `kind`
