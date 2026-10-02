'use client';

import { useEffect, useRef } from 'react';
import markDark from './mark.png';
import markLight from './mark-light.png';
import { createLgp } from './lgp';
import { MODE_EVENT } from './mode';

/* The animated mark on the sign-in screen. The two mark files are bundled
   (served from /_next/static) because /parent/* is behind the sign-in guard
   and the login screen must show the bulb before anyone has signed in. */

export function LoginMark() {
  const stage = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const logo = useRef<HTMLImageElement>(null);

  useEffect(() => {
    if (!stage.current || !canvas.current || !logo.current) return;
    const lgp = createLgp(
      { stage: stage.current, canvas: canvas.current, logo: logo.current },
      { dark: markDark.src, light: markLight.src },
    );
    lgp.start();
    const onMode = () => lgp.remode();
    const onResize = () => lgp.onResize();
    window.addEventListener(MODE_EVENT, onMode);
    window.addEventListener('resize', onResize, { passive: true });
    return () => {
      lgp.stop();
      window.removeEventListener(MODE_EVENT, onMode);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  return (
    <div className="lg-stage" ref={stage} aria-hidden="true">
      <canvas ref={canvas} />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="lg-logo" ref={logo} src={markDark.src} alt="" />
    </div>
  );
}
