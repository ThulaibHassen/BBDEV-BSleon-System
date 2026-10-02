'use client';

import { useEffect, useRef } from 'react';
import { PTS } from './pts';

/* ══ THE LOGIN MARK. Loose light gathers into Leon's bulb, switches on in
   white, and settles: the settled particles ARE the logo, so the formed
   shape and the final mark can never disagree. Quick by design, and reduced
   motion gets the finished mark with no cinema at all. Ported from the
   original LGP engine with its physics unchanged. Light mode draws dark ink
   and has no bloom (white light on a white page is nothing); the mark pops
   in instead. ══ */

const ASPECT = 0.823;
const CFGP = { particles: 900, driftMs: 240, gatherMs: 820, glowLead: 220, glowRamp: 260, glowStrength: 0.42, glowScale: 1.05, attraction: 0.16, damping: 0.78, drift: 0.07, size: 1.4, scatter: 1.6, maxDpr: 2 };
const INK = { dark: ['#f5f5f5', 'rgba(245,245,245,0)'], light: ['#121212', 'rgba(18,18,18,0)'] };

export function lgLight() {
  const m = document.documentElement.getAttribute('data-mode') || '';
  return m === 'light' || (!m && !!window.matchMedia?.('(prefers-color-scheme: light)').matches);
}
const markFile = () => (lgLight() ? '/student/mark-light.png' : '/student/mark.png');

export function LoginMark() {
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const logoRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const logo = logoRef.current!;
    const stage = stageRef.current!;
    const ctx = canvas.getContext('2d', { alpha: true })!;
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
    let glow: HTMLCanvasElement | null = null;
    let W = 0,
      H = 0,
      DPR = 1,
      raf = 0,
      t0 = 0,
      running = false;
    const T1 = CFGP.driftMs,
      T2 = T1 + CFGP.gatherMs,
      TEND = T2 + 260;
    const easeOut = (t: number) => {
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const u = 1 - t;
      return 1 - u * u * u * u;
    };
    const b = { x: 0, y: 0, w: 0, h: 0 };
    const box = () => {
      const cr = canvas.getBoundingClientRect(),
        mr = logo.getBoundingClientRect();
      if (mr.width > 4 && mr.height > 4) {
        b.x = mr.left - cr.left;
        b.y = mr.top - cr.top;
        b.w = mr.width;
        b.h = mr.height;
        return b;
      }
      const h = Math.min(H * 0.92, 120),
        w = h * ASPECT;
      b.x = (W - w) / 2;
      b.y = (H - h) / 2;
      b.w = w;
      b.h = h;
      return b;
    };
    const syncMark = () => {
      if (logo.getAttribute('src') !== markFile()) logo.setAttribute('src', markFile());
    };
    const spritesBuild = () => {
      sprites.length = 0;
      const r = CFGP.size * DPR,
        d = Math.ceil(r * 2) + 2,
        levels = [0.45, 0.75, 1];
      const ink = INK[lgLight() ? 'light' : 'dark'];
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
      if (lgLight()) {
        glow = null;
        return;
      }
      const bb = box(),
        gs = Math.max(2, Math.round(bb.h * CFGP.glowScale * DPR));
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
      glow = gc;
    };
    const layout = () => {
      const bb = box();
      for (let i = 0; i < N; i++) {
        const j = (i * 2) % (PTS.length - 1);
        tx[i] = bb.x + (PTS[j] / 1000) * bb.w;
        ty[i] = bb.y + (PTS[j + 1] / 1000) * bb.h;
      }
    };
    const seedP = () => {
      const bb = box(),
        s = Math.max(bb.w, bb.h) * CFGP.scatter;
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
    };
    const resize = () => {
      const r = canvas.getBoundingClientRect();
      W = r.width || 300;
      H = r.height || 136;
      DPR = Math.min(devicePixelRatio || 1, CFGP.maxDpr);
      canvas.width = Math.round(W * DPR);
      canvas.height = Math.round(H * DPR);
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      layout();
      spritesBuild();
    };
    const render = (t: number) => {
      ctx.clearRect(0, 0, W, H);
      const gather = easeOut((t - T1) / CFGP.gatherMs),
        loose = 1 - gather;
      if (glow && t > T2 - CFGP.glowLead) {
        const gOn = Math.min(1, (t - (T2 - CFGP.glowLead)) / CFGP.glowRamp);
        const bb = box(),
          gw = glow.width / DPR,
          gh = glow.height / DPR;
        ctx.globalAlpha = gOn * CFGP.glowStrength;
        ctx.drawImage(glow, bb.x + bb.w / 2 - gw / 2, bb.y + bb.h / 2 - gh / 2, gw, gh);
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
        for (let j = 0; j < N; j++) {
          if (sp[j] !== k) continue;
          ctx.drawImage(s2, px[j] - hw, py[j] - hw, s2.width / DPR, s2.height / DPR);
        }
      }
    };
    const reveal = (on: boolean) => stage.classList.toggle('revealed', on);
    const still = () => {
      for (let i = 0; i < N; i++) {
        px[i] = tx[i];
        py[i] = ty[i];
        vx[i] = 0;
        vy[i] = 0;
      }
      render(TEND + 999);
    };
    const frame = (now: number) => {
      const t = now - t0;
      render(t);
      if (t >= T2 - 60) reveal(true); /* crisp mark takes over as they land */
      if (t < TEND) raf = requestAnimationFrame(frame);
      else {
        running = false;
        still();
      }
    };
    syncMark();
    reveal(false);
    resize();
    seedP();
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      still();
      reveal(true);
    } else {
      t0 = performance.now();
      running = true;
      raf = requestAnimationFrame(frame);
    }
    /* the mode changed under us: re-point the mark, re-ink the dust */
    const remode = () => {
      syncMark();
      spritesBuild();
      if (!running) still();
    };
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    mq.addEventListener?.('change', remode);
    const onResize = () => {
      resize();
      still();
    };
    window.addEventListener('resize', onResize, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      mq.removeEventListener?.('change', remode);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  return (
    <div className="lg-stage" ref={stageRef} aria-hidden="true">
      <canvas ref={canvasRef} />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="lg-logo" ref={logoRef} src="/student/mark.png" alt="" />
    </div>
  );
}
