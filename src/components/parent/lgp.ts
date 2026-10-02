'use client';

import { PTS } from './lgp-points';
import { isLight } from './mode';

/* ══ THE LOGIN MARK. Loose light gathers into Leon's bulb, switches on in
   WHITE, and settles: the settled particles ARE the logo, so the formed shape
   and the final mark can never disagree. Quick by design, an intro not a
   ceremony, and reduced motion gets the finished mark with no cinema at all.

   The engine is the original LGP, line for line: same constants, seeding,
   physics and sprites. Only the plumbing changed — it is bound to the
   elements it is given instead of looking them up by id, and the two mark
   files are passed in (they are bundled assets, see LoginMark). ══ */

export type LgpEls = { stage: HTMLElement; canvas: HTMLCanvasElement; logo: HTMLImageElement };
export type MarkFiles = { dark: string; light: string };

const ASPECT = 0.823;
const CFGP = {
  particles: 900,
  driftMs: 240,
  gatherMs: 820,
  glowLead: 220,
  glowRamp: 260,
  glowStrength: 0.42,
  glowScale: 1.05,
  attraction: 0.16,
  damping: 0.78,
  drift: 0.07,
  size: 1.4,
  scatter: 1.6,
  maxDpr: 2,
};
/* the dust fades to a transparent version of ITS OWN ink. Fading dark dust
   out through transparent white puts a pale ring around every particle. */
const INK = { dark: ['#f5f5f5', 'rgba(245,245,245,0)'], light: ['#121212', 'rgba(18,18,18,0)'] };

export function createLgp(els: LgpEls, files: MarkFiles) {
  const { canvas, logo, stage } = els;
  const ctx = canvas.getContext('2d', { alpha: true })!;
  let W = 0,
    H = 0,
    DPR = 1,
    raf = 0,
    t0 = 0,
    running = false,
    alive = true;
  const N = CFGP.particles;
  const px = new Float32Array(N),
    py = new Float32Array(N),
    vx = new Float32Array(N),
    vy = new Float32Array(N);
  const tx = new Float32Array(N),
    ty = new Float32Array(N),
    ox = new Float32Array(N),
    oy = new Float32Array(N);
  const dl = new Float32Array(N),
    sp = new Uint8Array(N);
  const sprites: HTMLCanvasElement[] = [];
  let glowSprite: HTMLCanvasElement | null = null;
  const T1 = CFGP.driftMs,
    T2 = T1 + CFGP.gatherMs,
    TEND = T2 + 260;

  const markFile = () => (isLight() ? files.light : files.dark);
  function syncMark() {
    if (logo.getAttribute('src') !== markFile()) logo.setAttribute('src', markFile());
  }
  function easeOut(t: number) {
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const u = 1 - t;
    return 1 - u * u * u * u;
  }
  const _b = { x: 0, y: 0, w: 0, h: 0 };
  function box() {
    const cr = canvas.getBoundingClientRect(),
      mr = logo.getBoundingClientRect();
    if (mr.width > 4 && mr.height > 4) {
      _b.x = mr.left - cr.left;
      _b.y = mr.top - cr.top;
      _b.w = mr.width;
      _b.h = mr.height;
      return _b;
    }
    const h = Math.min(H * 0.92, 120),
      w = h * ASPECT; /* pre-layout only */
    _b.x = (W - w) / 2;
    _b.y = (H - h) / 2;
    _b.w = w;
    _b.h = h;
    return _b;
  }
  function spritesBuild() {
    sprites.length = 0;
    const r = CFGP.size * DPR,
      d = Math.ceil(r * 2) + 2,
      levels = [0.45, 0.75, 1];
    const ink = INK[isLight() ? 'light' : 'dark'];
    for (let k = 0; k < 3; k++) {
      const c = document.createElement('canvas');
      c.width = c.height = d;
      const g = c.getContext('2d')!;
      const grd = g.createRadialGradient(d / 2, d / 2, 0, d / 2, d / 2, r);
      grd.addColorStop(0, ink[0]);
      grd.addColorStop(1, ink[1]);
      g.globalAlpha = levels[k];
      g.fillStyle = grd;
      g.beginPath();
      g.arc(d / 2, d / 2, r, 0, Math.PI * 2);
      g.fill();
      sprites.push(c);
    }
    /* the switch-on is WHITE light, sized from the bulb, never the screen.
       Light mode has no bloom at all — white light on a white page is nothing,
       and the pop on .lg-logo carries the moment instead. */
    if (isLight()) {
      glowSprite = null;
      return;
    }
    const b = box(),
      gs = Math.max(2, Math.round(b.h * CFGP.glowScale * DPR));
    const gc = document.createElement('canvas');
    gc.width = gc.height = gs;
    const gg = gc.getContext('2d')!;
    const rg = gg.createRadialGradient(gs / 2, gs / 2, 0, gs / 2, gs / 2, gs / 2);
    rg.addColorStop(0, 'rgba(255,255,255,.95)');
    rg.addColorStop(0.3, 'rgba(255,255,255,.28)');
    rg.addColorStop(0.62, 'rgba(255,255,255,.07)');
    rg.addColorStop(1, 'rgba(255,255,255,0)');
    gg.fillStyle = rg;
    gg.fillRect(0, 0, gs, gs);
    glowSprite = gc;
  }
  function layout() {
    const b = box();
    for (let i = 0; i < N; i++) {
      const j = (i * 2) % (PTS.length - 1);
      tx[i] = b.x + (PTS[j] / 1000) * b.w;
      ty[i] = b.y + (PTS[j + 1] / 1000) * b.h;
    }
  }
  function seedP() {
    const b = box(),
      s = Math.max(b.w, b.h) * CFGP.scatter;
    for (let i = 0; i < N; i++) {
      const a = (i * 2.399963) % (Math.PI * 2);
      const r = s * (0.18 + 0.82 * Math.sqrt(((i * 97) % 100) / 100));
      px[i] = tx[i] + Math.cos(a) * r;
      py[i] = ty[i] + Math.sin(a) * r;
      ox[i] = px[i];
      oy[i] = py[i];
      vx[i] = 0;
      vy[i] = 0;
      dl[i] = (((i * 53) % 100) / 100) * 140;
      sp[i] = i % 3;
    }
  }
  function resize() {
    const r = canvas.getBoundingClientRect();
    W = r.width || 300;
    H = r.height || 136;
    DPR = Math.min(devicePixelRatio || 1, CFGP.maxDpr);
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    layout();
    spritesBuild();
  }
  function render(t: number) {
    ctx.clearRect(0, 0, W, H);
    const gather = easeOut((t - T1) / CFGP.gatherMs),
      loose = 1 - gather;
    if (glowSprite && t > T2 - CFGP.glowLead) {
      const gOn = Math.min(1, (t - (T2 - CFGP.glowLead)) / CFGP.glowRamp);
      const b = box(),
        gw = glowSprite.width / DPR,
        gh = glowSprite.height / DPR;
      ctx.globalAlpha = gOn * CFGP.glowStrength;
      ctx.drawImage(glowSprite, b.x + b.w / 2 - gw / 2, b.y + b.h / 2 - gh / 2, gw, gh);
      ctx.globalAlpha = 1;
    }
    for (let i = 0; i < N; i++) {
      const local = easeOut((t - CFGP.driftMs - dl[i]) / CFGP.gatherMs);
      const gx = ox[i] + (tx[i] - ox[i]) * local,
        gy = oy[i] + (ty[i] - oy[i]) * local;
      vx[i] += (gx - px[i]) * CFGP.attraction;
      vy[i] += (gy - py[i]) * CFGP.attraction;
      if (loose > 0.001) {
        vx[i] += Math.sin(t * 0.0012 + i) * CFGP.drift * loose;
        vy[i] += Math.cos(t * 0.0015 + i) * CFGP.drift * loose;
      }
      vx[i] *= CFGP.damping;
      vy[i] *= CFGP.damping;
      px[i] += vx[i];
      py[i] += vy[i];
    }
    for (let k = 0; k < 3; k++) {
      const s2 = sprites[k],
        hw = s2.width / DPR / 2;
      for (let j2 = 0; j2 < N; j2++) {
        if (sp[j2] !== k) continue;
        ctx.drawImage(s2, px[j2] - hw, py[j2] - hw, s2.width / DPR, s2.height / DPR);
      }
    }
  }
  function reveal(on: boolean) {
    stage.classList.toggle('revealed', !!on);
  }
  function frame(now: number) {
    if (!alive) return;
    const t = now - t0;
    render(t);
    if (t >= T2 - 60) reveal(true); /* crisp mark takes over as they land */
    if (t < TEND) raf = requestAnimationFrame(frame);
    else {
      running = false;
      still();
    }
  }
  function still() {
    /* the finished mark: particles pinned to their targets */
    for (let i = 0; i < N; i++) {
      px[i] = tx[i];
      py[i] = ty[i];
      vx[i] = 0;
      vy[i] = 0;
    }
    render(TEND + 999);
  }
  /* the mode changed under us. Re-point the mark, re-ink the dust and repaint
     the settled frame. */
  function remode() {
    syncMark();
    spritesBuild();
    if (!running) still();
  }
  function start() {
    syncMark();
    cancelAnimationFrame(raf);
    reveal(false);
    resize();
    seedP();
    /* reduced motion gets the finished logo at once, no cinema */
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      still();
      reveal(true);
      return;
    }
    t0 = performance.now();
    running = true;
    raf = requestAnimationFrame(frame);
  }
  function onResize() {
    resize();
    still();
  }
  function stop() {
    alive = false;
    cancelAnimationFrame(raf);
  }
  return { start, still, remode, onResize, stop };
}
