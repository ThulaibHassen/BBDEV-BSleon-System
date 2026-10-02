import type { Metadata, Viewport } from 'next';
import '@/styles/student.css';
import './student-extra.css';

export const metadata: Metadata = {
  title: 'BSWL Student',
  description: 'Know what to study next, and why.',
  manifest: '/student/manifest.json',
  icons: { apple: '/student/apple-touch-icon.png' },
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'BSWL Student' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#0d0d0d',
};

/* THE THEME IS SET BEFORE THE FIRST PAINT, so a student who chose Light never
   watches the dark theme flash past on every open. Two attributes, two jobs:
   data-theme is the colour, data-mode is light or dark (absent = Auto). The
   browser chrome colour moves with it. */
const THEME = `(function(){try{
var k=localStorage.getItem('bswl_theme')||'mono',m=localStorage.getItem('bswl_mode')||'';
document.documentElement.setAttribute('data-theme',k);
if(m)document.documentElement.setAttribute('data-mode',m);
var light=m==='light'||(!m&&window.matchMedia&&window.matchMedia('(prefers-color-scheme: light)').matches);
var t=document.querySelector('meta[name="theme-color"]');
if(t)t.setAttribute('content',light?'#f6f6f7':'#0d0d0d');
}catch(e){}})();`;

/* The worker is served by app/student/sw.js/route.ts with scope /student, so
   it controls the app page itself (a file in public/student could only reach
   /student/...). Registered on https, and on localhost for testing. */
const SW = `if('serviceWorker' in navigator&&(location.protocol==='https:'||location.hostname==='localhost'))navigator.serviceWorker.register('/student/sw.js',{scope:'/student'}).catch(function(){})`;

export default function StudentLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: THEME }} />
      {/* Poppins 800 is what the quiz, the paper clock and the scores were drawn in */}
      {/* eslint-disable-next-line @next/next/no-page-custom-font */}
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Poppins:wght@800&display=swap" />
      {children}
      <script dangerouslySetInnerHTML={{ __html: SW }} />
    </>
  );
}
