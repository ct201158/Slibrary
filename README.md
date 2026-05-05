# Slibrary

A JavaScript wrapper around slither.io's internals. Paste it into the browser console (or load it from a GitHub URL) and you get programmatic access to your snake, every visible enemy, food and prey, the leaderboard, plus prediction, danger scoring, steering, and an event loop.

The library is published as **Slibrary**. The runtime namespace it exposes on `window` is `SlitherAPI`.

**Version:** `1.0.2`
**License:** MIT
**File:** `slither_api.js`

---

## Loading

The script is a single self contained IIFE. It attaches itself to `window.SlitherAPI` and starts a `requestAnimationFrame` loop on load. Loading the script a second time safely shuts down the previous instance before installing the new one.

### 1. Direct paste

Open https://slither.io, hit `F12` to open DevTools, paste the contents of `slither_api.js` into the Console tab, press Enter.

### 2. From GitHub via jsDelivr (recommended)

```js
(() => {
  const s = document.createElement('script');
  s.src = 'https://cdn.jsdelivr.net/gh/USERNAME/Slibrary@main/slither_api.js';
  document.head.appendChild(s);
})();
```

Replace `USERNAME/Slibrary` with the path to your fork. To pin a specific commit, swap `@main` for `@<commit_sha>`.

jsDelivr is preferred over raw GitHub for `<script>` tag loading because it serves files with `Content-Type: application/javascript`. `raw.githubusercontent.com` serves `text/plain`, which Chrome refuses to execute as a script tag.

### 3. fetch + eval (works with any URL)

```js
fetch('https://raw.githubusercontent.com/USERNAME/Slibrary/main/slither_api.js')
  .then(r => r.text())
  .then(eval);
```

Works even with raw GitHub URLs because the DevTools console bypasses page CSP.

### 4. Bookmarklet

Save as a browser bookmark, then click it once you are on slither.io:

```
javascript:fetch('https://cdn.jsdelivr.net/gh/USERNAME/Slibrary@main/slither_api.js').then(r=>r.text()).then(eval);
```

### Defer auto start

By default the script calls `SlitherAPI.start()` at the end of the IIFE. To prevent that, set the flag before loading:

```js
window.SLITHER_API_DEFER_START = true;
// ... then load the script ...
SlitherAPI.start();   // when you are ready
```

---

## Quick start

```js
const S = window.SlitherAPI;

// Lifecycle hooks.
S.on('spawn',  ()           => console.log('spawned'));
S.on('death',  ()           => console.log('died'));
S.on('kill',   ({ total })  => console.log('total kills:', total));

// Drive yourself toward the nearest food every frame.
S.on('frame', () => {
  const p = S.pos();
  const c = S.closestFood(p.x, p.y);
  if (c) S.steerToWorld(c.food.xx, c.food.yy);
});
```

---

## API reference

All methods live on the singleton `window.SlitherAPI`. The examples below assume `const S = window.SlitherAPI;`.

### Core queries

Safe whether you are alive, dead, or on the login screen.

```js
S.isAlive()        // boolean: true when in game with a live snake
S.self()           // your snake object, or null if dead
S.enemies()        // array of visible enemy snake objects
S.food()           // array of visible food pellets
S.preys()          // array of visible prey orbs (the moving food)
S.gsc()            // number: current zoom factor
S.worldRadius()    // number: map radius in world units (~32550)
S.fps()            // number: game's reported FPS
S.leaderboard()    // array: current leaderboard entries
S.rank()           // number: your current rank
S.version          // string: '1.0.2'
```

### Own snake properties

Return `null` (or `0` for `kills()`) when dead.

```js
S.pos()            // {x, y} world coordinates
S.angle()          // number: heading in radians
S.heading()        // {x, y} unit vector
S.speed()          // number: raw game speed
S.speedWU()        // number: world units per second
S.cruiseSpeed()    // number: base cruise speed
S.boostSpeed()     // number: boost speed
S.isBoosting()     // boolean
S.scale()          // number: mass proxy (starts ~1.0, grows)
S.length()         // number: total body segments
S.bodyRadius()     // number: collision radius in world units
S.kills()          // number: kills this life
S.color()          // {r, g, b, hex}
S.nick()           // string: your nickname
S.bodyPoints()     // array of {x, y}, head first
```

### World and screen coordinates

The game renders the world centered on your snake. These helpers convert between **world coordinates** (the values stored in snakes, food, etc.) and **CSS pixel coordinates** on the page.

```js
S.transform()                    // {scale, cx, cy, canvasRect} or null
S.toScreen(wx, wy)               // {x, y} CSS px, or null
S.toWorld(sx, sy)                // {x, y} world units, or null
S.isOnScreen(wx, wy, margin = 0) // boolean
```

`transform()` recomputes every call, so values are always fresh. It returns `null` if the game canvas has not initialized yet.

### Steering

The only reliable way to steer in slither.io is to dispatch synthetic mouse events. These helpers do that for you, hitting both `window` and `document` listeners.

```js
S.steerToWorld(wx, wy)   // turn toward a world point
S.steerAngle(angle)      // turn to a heading in radians
S.steerToSnake(snake)    // turn toward a snake's head
```

All return `true` on success, `false` if the transform or target is unavailable. The real cursor still works alongside the API.

### Math and spatial helpers

```js
S.dist(ax, ay, bx, by)
S.distToSelf(wx, wy)
S.angleTo(fromX, fromY, toX, toY)
S.angleToWorld(wx, wy)
S.normalizeAngle(a)              // wraps to [-PI, PI]
S.angleDiff(a, b)                // signed difference, [-PI, PI]
S.inBounds(wx, wy)               // inside the world circle?
S.closestFood(wx, wy)            // {food, dist} or null
S.closestEnemy(wx, wy)           // {snake, dist} or null
```

### Prediction

```js
S.predict(snake, steps = 20, dt = 0.065)
```

Returns an array of `{x, y, t, ang}` predictions for the snake over the next `steps * dt` seconds. Uses an exponentially weighted angular velocity from recent history, so a turning snake's path bends correctly. Returns `[]` if the snake has no history yet (the first frames after a snake appears).

```js
S.findIntercept(snake, steps = 20, dt = 0.065)
```

Searches the prediction for a point you can reach with a boost before the enemy gets there. Returns `{ x, y, t, travelTime, advantage, score, index }` or `null` if no intercept is feasible. `advantage` is in seconds (positive means you arrive first). `score` is a normalized blend of distance, time advantage, and how aligned the intercept is with your current heading.

### Danger assessment

```js
S.danger()             // number 0..1: how immediate the threat is
S.safestAngle(n = 8)   // radians: best escape heading
```

`danger()` looks at every enemy's prediction and scores by how close they will get to your head, weighted higher for threats coming from in front (within ~108 degrees of your heading). `safestAngle()` tests `n` candidate directions evenly around the compass and returns the one whose probe point is furthest from any predicted enemy location, ignoring directions that would leave the world.

### History

```js
S.historyOf(snake)     // raw [{xx, yy, ang, sp, t}, ...]
```

The API automatically records a sliding window of every visible snake's recent state, used internally by `predict()`. You can query it directly for trail visualizations or your own modeling. History is keyed by `snake.id` when available, so it survives object identity changes the game might make.

### Events

```js
S.on(event, fn)        // returns an unsubscribe function
S.off(event, fn?)      // remove one handler, or all if fn is omitted
```

Built in events:

| Event     | Payload                                                                | Fires when                           |
|-----------|------------------------------------------------------------------------|--------------------------------------|
| `frame`   | `{frame, self, enemies, pos, angle, isBoosting, danger}`               | Every animation frame while alive.   |
| `spawn`   | `{frame}`                                                              | You enter the game.                  |
| `death`   | `{frame}`                                                              | You die or leave the game.           |
| `kill`    | `{count, total}`                                                       | You score one or more kills.         |
| `boost`   | `{frame}`                                                              | You start boosting.                  |
| `unboost` | `{frame}`                                                              | You stop boosting.                   |

Errors thrown by handlers are caught and logged so one bad listener does not break the loop. A handler that unsubscribes itself during dispatch is safe; the iteration uses a snapshot of the listener list.

### Lifecycle

```js
S.start()    // start the RAF loop (idempotent)
S.stop()     // stop the loop
```

Re-loading the script automatically calls `stop()` on the previous instance.

### Overlay drawing

```js
S.overlay(id = 'sapi-overlay', zIndex = 9999)
S.removeOverlay(id = 'sapi-overlay')
```

`overlay()` returns `{ canvas, ctx }` for a `<canvas>` element pinned over the page with `pointer-events: none`. The canvas is reused across calls and resized when the window changes. The transform helper deliberately ignores any canvas with an id starting with `sapi-` so your overlay never gets confused with the game canvas.

```js
S.on('frame', () => {
  const o = S.overlay();
  if (!o) return;
  const { canvas, ctx } = o;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  S.enemies().forEach(e => {
    const pred = S.predict(e, 20);
    ctx.beginPath();
    pred.forEach((p, i) => {
      const sp = S.toScreen(p.x, p.y);
      if (!sp) return;
      if (i === 0) ctx.moveTo(sp.x, sp.y); else ctx.lineTo(sp.x, sp.y);
    });
    ctx.strokeStyle = 'rgba(255, 80, 80, 0.6)';
    ctx.lineWidth = 2;
    ctx.stroke();
  });
});
```

---

## Examples

### Auto food collector

```js
S.on('frame', () => {
  const p = S.pos();
  if (!p) return;
  const c = S.closestFood(p.x, p.y);
  if (c) S.steerToWorld(c.food.xx, c.food.yy);
});
```

### Panic dodge when enemies close in

```js
S.on('frame', () => {
  if (S.danger() > 0.5) {
    const a = S.safestAngle();
    if (a !== null) S.steerAngle(a);
  }
});
```

### Hunt for intercepts on smaller snakes

```js
S.on('frame', ({ enemies }) => {
  const me = S.self();
  if (!me) return;
  const targets = enemies.filter(e => e.sc < me.sc * 0.85);
  let best = null;
  for (const e of targets) {
    const ic = S.findIntercept(e);
    if (ic && (!best || ic.score > best.score)) best = { e, ic };
  }
  if (best) S.steerToWorld(best.ic.x, best.ic.y);
});
```

### Combine: gather, hunt, dodge

```js
S.on('frame', ({ enemies }) => {
  const me = S.self();
  if (!me) return;

  // 1. Survival first.
  if (S.danger() > 0.5) {
    return S.steerAngle(S.safestAngle());
  }

  // 2. Hunt smaller snakes if there's a clean intercept.
  const prey = enemies.filter(e => e.sc < me.sc * 0.85);
  for (const e of prey) {
    const ic = S.findIntercept(e);
    if (ic && ic.advantage > 0.3) return S.steerToWorld(ic.x, ic.y);
  }

  // 3. Otherwise gather food.
  const c = S.closestFood(me.xx, me.yy);
  if (c) S.steerToWorld(c.food.xx, c.food.yy);
});
```

---

## Snake object reference

Every entry in `window.slithers` is a snake. The fields you'll touch most:

| Field         | Meaning                                                              |
|---------------|----------------------------------------------------------------------|
| `id`          | Stable game id.                                                      |
| `xx`, `yy`    | Head position in world units.                                        |
| `ang`         | Heading in radians.                                                  |
| `sp`          | Current speed (raw game units).                                      |
| `ssp`         | Cruise speed.                                                        |
| `fsp`         | Boost speed.                                                         |
| `sc`          | Scale factor (mass proxy). Starts ~1.0.                              |
| `tl`          | Total body length in segments.                                       |
| `pts`         | Body segment chain, tail first.                                      |
| `kill_count`  | Kills this life.                                                     |
| `nk`          | Nickname.                                                            |
| `cs`          | CSS color string.                                                    |
| `na`          | Snake flag. `0` means it is the local player.                        |

---

## Notes and gotchas

* World coordinates are roughly in the range `±32550` and the world is a **circle**, not a square. Use `inBounds(x, y)` to test.
* `predict()` needs about 0.3 seconds of history before it produces meaningful turn rates. The first frame after a snake appears its omega is zero (straight line prediction).
* The fallback in `_snakeKey` for snakes with no `id` uses a positional + timestamp key. This is rare in practice; almost every snake has a stable id.
* `bodyRadius()` returns `sc * 29`, the standard slither.io collision radius. Useful for collision avoidance probes.
* All steering is just synthetic mouse moves; a real cursor still works alongside the API.
* If you load the script from jsDelivr and want fresh changes, append `?cb=<random>` or pin a commit sha.

---

## Compatibility

Tested against current public slither.io builds in Chrome, Firefox, and Edge. The script touches only documented globals (`window.slithers`, `window.foods`, `window.preys`, `window.lts`, `window.gsc`, `window.grd`, `window.fps`, `window.rank`) so it should survive minor game updates. If a future build renames these globals, the queries that depend on them are the only thing that needs patching.

---

## Contributing

Issues and pull requests welcome. If you're filing a bug, include the slither.io build hash (visible at the bottom of the login screen) and the `SlitherAPI.version`.
