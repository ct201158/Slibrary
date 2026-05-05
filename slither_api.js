/*!
 * SlitherAPI v1.0.2
 * Programmatic access to slither.io game state.
 * https://github.com/ct201158/Slibrary
 *
 * Load options:
 *   1. Paste this file's contents into the slither.io DevTools console.
 *   2. From GitHub via jsDelivr (recommended for <script> tags):
 *        (() => { const s = document.createElement('script');
 *                 s.src = 'https://cdn.jsdelivr.net/gh/USERNAME/Slibrary@main/slither_api.js';
 *                 document.head.appendChild(s); })();
 *   3. fetch + eval (works with raw.githubusercontent.com):
 *        fetch('https://raw.githubusercontent.com/USERNAME/Slibrary/main/slither_api.js')
 *          .then(r => r.text()).then(eval);
 *
 * Set window.SLITHER_API_DEFER_START = true before loading to skip the
 * auto-start of the internal RAF loop. Call SlitherAPI.start() when ready.
 *
 * License: MIT
 */
(function() {
'use strict';

// ═══════════════════════════════════════════════════════════
//  SLITHER.IO JS API BASE  v1.0.2
//  Paste into the slither.io console, or load from GitHub.
//  Re-loading safely tears down any previous instance.
// ═══════════════════════════════════════════════════════════

// If a prior instance exists, stop its RAF loop before we replace it.
if (window.SlitherAPI && typeof window.SlitherAPI.stop === 'function') {
  try { window.SlitherAPI.stop(); } catch (e) { /* noop */ }
}

const S = window.SlitherAPI = {

  // ─── VERSION ─────────────────────────────────────────────
  version: '1.0.2',

  // ─── INTERNAL STATE ──────────────────────────────────────
  _hooks: {},        // registered event callbacks
  _rafId: null,      // main loop RAF id
  _running: false,
  _frame: 0,         // frame counter
  _history: {},      // { snakeKey: [{xx,yy,ang,sp,t}, ...] }
  _historyMax: 60,   // frames of history kept per snake
  _wasAlive: false,  // edge detection
  _wasBoosting: false,
  _lastKills: 0,


  // ═══════════════════════════════════════════════════════
  //  CORE QUERIES  (safe to call dead or alive)
  // ═══════════════════════════════════════════════════════

  /** Is the player currently alive and in-game? */
  isAlive() {
    const login = document.getElementById('login');
    if (login && login.style.display !== 'none' && login.style.display !== '') return false;
    return !!(window.slithers && window.slithers.find(s => s && s.na === 0));
  },

  /** Get own snake object, or null if dead */
  self() {
    return (window.slithers && window.slithers.find(s => s && s.na === 0)) || null;
  },

  /** Get all visible enemy snake objects */
  enemies() {
    return (window.slithers || []).filter(s => s && s.na !== 0);
  },

  /** Get all food pellets as an array */
  food() {
    const f = window.foods;
    if (!f) return [];
    return Array.isArray(f) ? f.filter(Boolean) : Object.values(f).filter(Boolean);
  },

  /** Get all prey orbs as an array */
  preys() {
    const p = window.preys;
    if (!p) return [];
    return Array.isArray(p) ? p.filter(Boolean) : Object.values(p).filter(Boolean);
  },

  /** Current zoom scale */
  gsc() { return window.gsc || 1; },

  /** World radius. Map is a circle of this radius in world units. */
  worldRadius() { return window.grd || 32550; },

  /** Current FPS as reported by the game */
  fps() { return window.fps || 0; },

  /** Current leaderboard entries */
  leaderboard() { return window.lts || []; },

  /** Own current rank */
  rank() { return window.rank || 0; },


  // ═══════════════════════════════════════════════════════
  //  OWN SNAKE PROPERTIES  (return null/0 when dead)
  // ═══════════════════════════════════════════════════════

  pos() {
    const s = this.self();
    return s ? { x: s.xx, y: s.yy } : null;
  },

  angle() {
    const s = this.self();
    return s ? s.ang : null;
  },

  /** Heading as a unit vector */
  heading() {
    const a = this.angle();
    return a !== null ? { x: Math.cos(a), y: Math.sin(a) } : null;
  },

  speed() {
    const s = this.self();
    return s ? s.sp : null;
  },

  /** Speed in world units per second */
  speedWU() {
    const s = this.self();
    return s ? s.sp * 480 : null;
  },

  cruiseSpeed() {
    const s = this.self();
    return s ? s.ssp : null;
  },

  boostSpeed() {
    const s = this.self();
    return s ? s.fsp : null;
  },

  isBoosting() {
    const s = this.self();
    return s ? s.sp > s.ssp + 0.3 : false;
  },

  /** Scale factor. Proxy for score. Starts ~1.0, grows with mass. */
  scale() {
    const s = this.self();
    return s ? s.sc : null;
  },

  /** Total body length in segments */
  length() {
    const s = this.self();
    return s ? s.tl : null;
  },

  /** Snake's collision/body radius in world units */
  bodyRadius() {
    const s = this.self();
    return s ? s.sc * 29 : null;
  },

  /** Kills this life */
  kills() {
    const s = this.self();
    return s ? (s.kill_count || 0) : 0;
  },

  /** RGB head color */
  color() {
    const s = this.self();
    return s ? { r: s.rr, g: s.gg, b: s.bb, hex: s.cs } : null;
  },

  /** Nickname */
  nick() {
    const s = this.self();
    return s ? s.nk : null;
  },

  /** All body segment positions, head-first */
  bodyPoints() {
    const s = this.self();
    if (!s || !s.pts) return [];
    return s.pts.slice().reverse().map(p => ({ x: p.xx, y: p.yy }));
  },


  // ═══════════════════════════════════════════════════════
  //  WORLD ↔ SCREEN TRANSFORM
  // ═══════════════════════════════════════════════════════

  /** Returns the current transform, recalculated live. */
  transform() {
    const canvases = Array.from(document.querySelectorAll('canvas'));
    const isOurs = c => typeof c.id === 'string' &&
      (c.id === 'ironman-overlay' || c.id.startsWith('sapi-'));

    // Prefer the canvas the game renders to (1500 internal width).
    let gc = canvases.find(c => c.width === 1500 && !isOurs(c));
    if (!gc) {
      // Fallback: the largest visible non-overlay canvas.
      gc = canvases
        .filter(c => !isOurs(c))
        .map(c => ({ c, w: c.getBoundingClientRect().width }))
        .filter(o => o.w > 100)
        .sort((a, b) => b.w - a.w)
        .map(o => o.c)[0];
    }
    if (!gc) return null;

    const r = gc.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    const scale = (window.gsc || 1) * r.width / 1500;
    return {
      scale,                      // world units → CSS px
      cx: r.left + r.width / 2,   // screen center X (CSS px)
      cy: r.top + r.height / 2,   // screen center Y (CSS px)
      canvasRect: r
    };
  },

  /** World coord → CSS screen coord. null if transform unavailable. */
  toScreen(wx, wy) {
    const own = this.self();
    const tr = this.transform();
    if (!own || !tr) return null;
    return {
      x: tr.cx + (wx - own.xx) * tr.scale,
      y: tr.cy + (wy - own.yy) * tr.scale
    };
  },

  /** CSS screen coord → world coord */
  toWorld(sx, sy) {
    const own = this.self();
    const tr = this.transform();
    if (!own || !tr) return null;
    return {
      x: own.xx + (sx - tr.cx) / tr.scale,
      y: own.yy + (sy - tr.cy) / tr.scale
    };
  },

  /** Is a world coordinate currently on screen? */
  isOnScreen(wx, wy, margin = 0) {
    const s = this.toScreen(wx, wy);
    if (!s) return false;
    return s.x >= -margin && s.x <= window.innerWidth + margin &&
           s.y >= -margin && s.y <= window.innerHeight + margin;
  },


  // ═══════════════════════════════════════════════════════
  //  STEERING
  // ═══════════════════════════════════════════════════════

  /** Steer toward a world coordinate */
  steerToWorld(wx, wy) {
    const s = this.toScreen(wx, wy);
    if (!s) return false;
    this._dispatchMouse(s.x, s.y);
    return true;
  },

  /** Steer in a heading angle (radians) */
  steerAngle(angle) {
    const tr = this.transform();
    if (!tr) return false;
    const dist = Math.min(tr.canvasRect.width, tr.canvasRect.height) * 0.42;
    this._dispatchMouse(
      tr.cx + Math.cos(angle) * dist,
      tr.cy + Math.sin(angle) * dist
    );
    return true;
  },

  /** Steer toward another snake's head */
  steerToSnake(snake) {
    if (!snake || typeof snake.xx !== 'number' || typeof snake.yy !== 'number') return false;
    return this.steerToWorld(snake.xx, snake.yy);
  },

  /**
   * Dispatch a synthetic mousemove. Different builds of slither.io
   * attach the listener to either window or document, so we hit both.
   */
  _dispatchMouse(cssX, cssY) {
    const init = {
      clientX: cssX, clientY: cssY,
      bubbles: true, cancelable: true, view: window
    };
    try { window.dispatchEvent(new MouseEvent('mousemove', init)); } catch (e) { /* noop */ }
    try { document.dispatchEvent(new MouseEvent('mousemove', init)); } catch (e) { /* noop */ }
  },


  // ═══════════════════════════════════════════════════════
  //  MATH / SPATIAL HELPERS
  // ═══════════════════════════════════════════════════════

  dist(ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    return Math.sqrt(dx * dx + dy * dy);
  },

  distToSelf(wx, wy) {
    const p = this.pos();
    return p ? this.dist(p.x, p.y, wx, wy) : null;
  },

  angleTo(fromX, fromY, toX, toY) {
    return Math.atan2(toY - fromY, toX - fromX);
  },

  angleToWorld(wx, wy) {
    const p = this.pos();
    return p ? this.angleTo(p.x, p.y, wx, wy) : null;
  },

  /** Normalize angle to [-PI, PI]. Safe for arbitrarily large inputs. */
  normalizeAngle(a) {
    const TAU = 2 * Math.PI;
    return ((a + Math.PI) % TAU + TAU) % TAU - Math.PI;
  },

  /** Angular difference between two angles, result in [-PI, PI] */
  angleDiff(a, b) {
    return this.normalizeAngle(b - a);
  },

  /** Is a world point inside the world boundary? */
  inBounds(wx, wy) {
    const r = this.worldRadius();
    return Math.sqrt(wx * wx + wy * wy) < r;
  },

  /** Closest food pellet to a world point */
  closestFood(wx, wy) {
    let best = null, bestD = Infinity;
    this.food().forEach(f => {
      if (typeof f.xx !== 'number' || typeof f.yy !== 'number') return;
      const d = this.dist(wx, wy, f.xx, f.yy);
      if (d < bestD) { bestD = d; best = f; }
    });
    return best ? { food: best, dist: bestD } : null;
  },

  /** Closest enemy to a world point */
  closestEnemy(wx, wy) {
    let best = null, bestD = Infinity;
    this.enemies().forEach(e => {
      if (typeof e.xx !== 'number' || typeof e.yy !== 'number') return;
      const d = this.dist(wx, wy, e.xx, e.yy);
      if (d < bestD) { bestD = d; best = e; }
    });
    return best ? { snake: best, dist: bestD } : null;
  },


  // ═══════════════════════════════════════════════════════
  //  PREDICTION
  // ═══════════════════════════════════════════════════════

  /**
   * Predict where a snake will be over the next N steps.
   * Uses exponentially-weighted angular velocity from history.
   * Returns array of {x, y, t, ang} where t = seconds from now.
   */
  predict(snake, steps = 20, dt = 0.065) {
    if (!snake) return [];
    const key = this._snakeKey(snake);
    const hist = this._history[key] || [];

    // Exponentially-weighted angular velocity over recent history.
    let omega = 0, wTot = 0;
    const start = Math.max(1, hist.length - 15);
    let decay = 1;
    for (let i = hist.length - 1; i >= start; i--) {
      const dAng = this.normalizeAngle(hist[i].ang - hist[i - 1].ang);
      const dT = Math.max((hist[i].t - hist[i - 1].t) / 1000, 0.016);
      omega += (dAng / dT) * decay;
      wTot += decay;
      decay *= 0.75;
    }
    if (wTot > 0) omega /= wTot;
    omega = Math.max(-4, Math.min(4, omega)); // clamp to physical limit

    const baseSp = (typeof snake.sp === 'number' && snake.sp > 0)
      ? snake.sp
      : (snake.ssp || 0.0067);
    const spd = baseSp * 480; // wu/s

    const pts = [];
    let x = snake.xx, y = snake.yy, a = snake.ang || 0;
    for (let i = 0; i < steps; i++) {
      a = this.normalizeAngle(a + omega * dt);
      x += Math.cos(a) * spd * dt;
      y += Math.sin(a) * spd * dt;
      pts.push({ x, y, t: (i + 1) * dt, ang: a });
    }
    return pts;
  },

  /**
   * Find the best intercept point on a predicted path where own snake
   * can arrive before the enemy (using boost speed).
   * Returns { x, y, t, travelTime, advantage, score, index } or null.
   */
  findIntercept(snake, steps = 20, dt = 0.065) {
    const own = this.self();
    if (!own || !snake) return null;
    const pred = this.predict(snake, steps, dt);
    if (!pred.length) return null;

    // Real boost speed if available, else assume ~2x cruise (slither default).
    const boostBase = (typeof own.fsp === 'number' && own.fsp > 0)
      ? own.fsp
      : own.ssp * 2;
    const boostSpd = boostBase * 480;
    if (!boostSpd) return null;

    const ox = own.xx, oy = own.yy, ownAng = own.ang || 0;
    let best = null, bestScore = -Infinity;

    for (let i = 1; i < pred.length; i++) {
      const p = pred[i];
      const T = p.t;
      const D = this.dist(ox, oy, p.x, p.y);
      const travelTime = D / boostSpd;
      const advantage = T - travelTime;
      if (advantage < 0.15) continue; // can't make it in time

      const distScore = 1 / (1 + D / 400);
      const timeScore = Math.min(advantage / 0.5, 1.0);
      const angToPoint = Math.atan2(p.y - oy, p.x - ox);
      const dirScore = 1 - Math.abs(this.angleDiff(ownAng, angToPoint)) / Math.PI * 0.5;
      const score = distScore * 0.4 + timeScore * 0.35 + dirScore * 0.25;

      if (score > bestScore) {
        bestScore = score;
        best = { x: p.x, y: p.y, t: T, travelTime, advantage, score, index: i };
      }
    }
    return best;
  },


  // ═══════════════════════════════════════════════════════
  //  DANGER ASSESSMENT
  // ═══════════════════════════════════════════════════════

  /**
   * Returns urgency 0..1 of current danger from all enemies.
   * 1.0 = imminent collision. Front-facing threats weigh more.
   */
  danger() {
    const own = this.self();
    if (!own) return 0;
    const dangerRadius = own.sc * 17 + 30;
    const ownAng = own.ang || 0;
    let maxUrgency = 0;

    this.enemies().forEach(snake => {
      const pred = this.predict(snake, 10, 0.06);
      for (let i = 0; i < pred.length; i++) {
        const p = pred[i];
        const D = this.dist(own.xx, own.yy, p.x, p.y);
        if (D >= dangerRadius) continue;
        const angToThreat = this.angleTo(own.xx, own.yy, p.x, p.y);
        const diff = Math.abs(this.angleDiff(ownAng, angToThreat));
        const frontWeight = diff < 1.88 ? 1.5 : 1.0; // front ~108°
        const u = (1 - D / dangerRadius) * Math.max(0, 1 - i * 0.08) * frontWeight;
        if (u > maxUrgency) maxUrgency = u;
      }
    });
    return Math.min(maxUrgency, 1);
  },

  /**
   * Find the safest escape angle from current position.
   * Tests N candidate angles and scores by minimum predicted enemy distance.
   * Out-of-bounds candidates are ranked below all in-bounds options.
   */
  safestAngle(candidates = 8) {
    const own = this.self();
    if (!own) return null;
    const dangerRadius = own.sc * 17 + 30;
    const ownAng = own.ang || 0;
    const step = (2 * Math.PI) / candidates;
    const probe = dangerRadius * 2;

    let bestAng = ownAng, bestClear = -Infinity;

    for (let i = 0; i < candidates; i++) {
      const testAng = ownAng + i * step;
      const testX = own.xx + Math.cos(testAng) * probe;
      const testY = own.yy + Math.sin(testAng) * probe;
      let minDist = Infinity;

      this.enemies().forEach(snake => {
        const pred = this.predict(snake, 8, 0.06);
        for (const p of pred) {
          const d = this.dist(testX, testY, p.x, p.y);
          if (d < minDist) minDist = d;
        }
      });

      // Strongly penalize directions that leave the world boundary so
      // they sort below any in-bounds option, even a bad one.
      if (!this.inBounds(testX, testY)) minDist = -1e9;

      if (minDist > bestClear) { bestClear = minDist; bestAng = testAng; }
    }
    return bestAng;
  },


  // ═══════════════════════════════════════════════════════
  //  HISTORY
  // ═══════════════════════════════════════════════════════

  /**
   * Stable identity for a snake.
   * Prefers the game-assigned id. Only falls back to a positional cache
   * for the rare case of a snake with no id.
   */
  _snakeKey(snake) {
    if (snake.id !== undefined && snake.id !== null) return 'sn_id_' + snake.id;
    if (snake._sApiKey) return snake._sApiKey;
    const key = 'sn_p_' + Math.round(snake.xx) + '_' + Math.round(snake.yy) + '_' + Date.now();
    snake._sApiKey = key;
    return key;
  },

  _updateHistory() {
    const now = Date.now();
    const snakes = window.slithers || [];
    const activeKeys = new Set();
    for (const snake of snakes) {
      if (!snake || typeof snake.xx !== 'number' || typeof snake.yy !== 'number') continue;
      const key = this._snakeKey(snake);
      activeKeys.add(key);
      let h = this._history[key];
      if (!h) { h = this._history[key] = []; }
      const last = h[h.length - 1];
      if (!last || now - last.t > 20) {
        h.push({ xx: snake.xx, yy: snake.yy, ang: snake.ang, sp: snake.sp, t: now });
        if (h.length > this._historyMax) h.shift();
      }
    }
    // Prune history for snakes that are no longer present.
    for (const k of Object.keys(this._history)) {
      if (!activeKeys.has(k)) delete this._history[k];
    }
  },

  /** Get raw history array for a snake */
  historyOf(snake) {
    if (!snake) return [];
    return this._history[this._snakeKey(snake)] || [];
  },


  // ═══════════════════════════════════════════════════════
  //  EVENT SYSTEM
  // ═══════════════════════════════════════════════════════

  /**
   * Register a callback for a named event.
   * Built-in events: 'frame', 'spawn', 'death', 'kill', 'boost', 'unboost'
   * Returns an unsubscribe function.
   */
  on(event, fn) {
    if (typeof fn !== 'function') return () => {};
    if (!this._hooks[event]) this._hooks[event] = [];
    this._hooks[event].push(fn);
    return () => this.off(event, fn);
  },

  /** Remove a single handler, or all handlers for an event when fn is omitted. */
  off(event, fn) {
    if (!this._hooks[event]) return;
    if (!fn) { this._hooks[event] = []; return; }
    this._hooks[event] = this._hooks[event].filter(f => f !== fn);
  },

  _emit(event, data) {
    const list = this._hooks[event];
    if (!list || !list.length) return;
    // Snapshot so a handler that unsubscribes itself cannot corrupt iteration.
    const snapshot = list.slice();
    for (const fn of snapshot) {
      try { fn(data); } catch (e) { console.error('[SlitherAPI] event', event, e); }
    }
  },


  // ═══════════════════════════════════════════════════════
  //  MAIN LOOP
  // ═══════════════════════════════════════════════════════

  /** Start the API loop. Idempotent. */
  start() {
    if (this._running) return this;
    this._running = true;
    // Seed edge-detection state from current reality so calling start()
    // mid-game does not fire phantom spawn / kill / boost events.
    this._wasAlive = this.isAlive();
    const own0 = this.self();
    this._lastKills = own0 ? (own0.kill_count || 0) : 0;
    this._wasBoosting = this.isBoosting();
    this._loop();
    console.log('[SlitherAPI] started');
    return this;
  },

  stop() {
    this._running = false;
    if (this._rafId) cancelAnimationFrame(this._rafId);
    this._rafId = null;
    console.log('[SlitherAPI] stopped');
    return this;
  },

  _loop() {
    if (!this._running) return;
    this._rafId = requestAnimationFrame(() => this._loop());
    this._frame++;

    this._updateHistory();

    // Alive/dead edge detection.
    const alive = this.isAlive();
    if (alive && !this._wasAlive) {
      this._history = {};      // clear stale history on respawn
      this._lastKills = 0;
      this._emit('spawn', { frame: this._frame });
    }
    if (!alive && this._wasAlive) {
      this._wasBoosting = false;
      this._emit('death', { frame: this._frame });
    }
    this._wasAlive = alive;

    const own = this.self();
    if (own) {
      const kc = own.kill_count || 0;
      if (kc > this._lastKills) {
        this._emit('kill', { count: kc - this._lastKills, total: kc });
      }
      this._lastKills = kc;

      const boosting = this.isBoosting();
      if (boosting && !this._wasBoosting) this._emit('boost', { frame: this._frame });
      if (!boosting && this._wasBoosting) this._emit('unboost', { frame: this._frame });
      this._wasBoosting = boosting;
    }

    if (alive) {
      this._emit('frame', {
        frame: this._frame,
        self: own,
        enemies: this.enemies(),
        pos: this.pos(),
        angle: this.angle(),
        isBoosting: this.isBoosting(),
        danger: this.danger()
      });
    }
  },


  // ═══════════════════════════════════════════════════════
  //  OVERLAY CANVAS HELPER
  // ═══════════════════════════════════════════════════════

  /**
   * Get (or create) a persistent overlay canvas for drawing.
   * Always matches window size. pointer-events: none.
   * Returns { canvas, ctx } or null if DOM is not ready.
   */
  overlay(id = 'sapi-overlay', zIndex = 9999) {
    if (!document.body) return null;
    let cv = document.getElementById(id);
    const W = window.innerWidth, H = window.innerHeight;
    if (!cv) {
      cv = document.createElement('canvas');
      cv.id = id;
      Object.assign(cv.style, {
        position: 'fixed', left: '0', top: '0',
        width: W + 'px', height: H + 'px',
        pointerEvents: 'none', zIndex: String(zIndex)
      });
      cv.width = W; cv.height = H;
      document.body.appendChild(cv);
    }
    if (cv.width !== W || cv.height !== H) {
      cv.width = W; cv.height = H;
      cv.style.width = W + 'px'; cv.style.height = H + 'px';
    }
    return { canvas: cv, ctx: cv.getContext('2d') };
  },

  /** Remove an overlay canvas */
  removeOverlay(id = 'sapi-overlay') {
    const el = document.getElementById(id);
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

};

// Auto-start the loop unless the consumer opted out before loading.
// To skip: set window.SLITHER_API_DEFER_START = true, then call S.start() yourself.
if (!window.SLITHER_API_DEFER_START) S.start();

})();
