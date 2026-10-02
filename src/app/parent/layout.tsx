import type { Metadata, Viewport } from 'next';
import '@/styles/parent.css';

/* The parent app: the student app's look to the letter, a parent's four
   questions. No webfont — the system stack, like the student app. */

export const metadata: Metadata = {
  title: 'BSWL Parent',
  manifest: '/parent/manifest.json',
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'BSWL Parent' },
  icons: { apple: '/parent/apple-touch-icon.png' },
  robots: { index: false, follow: false, nocache: true },
};

export const viewport: Viewport = { themeColor: '#0d0d0d' };

/* THE MODE IS SET BEFORE ANYTHING IS PAINTED. Run later and a parent who has
   chosen Light watches the dark theme flash past on every open. It also moves
   the browser chrome colour, so the strip above the page matches the page. */
const MODE = `(function(){try{
 var m=localStorage.getItem('bswl_par_mode')||'';
 if(m)document.documentElement.setAttribute('data-mode',m);
 var light=m==='light'||(!m&&window.matchMedia&&window.matchMedia('(prefers-color-scheme: light)').matches);
 var t=document.querySelector('meta[name="theme-color"]');
 if(t)t.setAttribute('content',light?'#f6f6f7':'#0d0d0d');
}catch(e){}})();`;

/* Scope '/parent' (not '/parent/') so the worker controls the hub itself;
   the route that serves sw.js sends Service-Worker-Allowed for it. */
const SW = `if('serviceWorker' in navigator&&location.protocol==='https:')navigator.serviceWorker.register('/parent/sw.js',{scope:'/parent'}).catch(function(){});`;

export default function ParentLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: MODE }} />
      {children}
      <script dangerouslySetInnerHTML={{ __html: SW }} />
    </>
  );
}
