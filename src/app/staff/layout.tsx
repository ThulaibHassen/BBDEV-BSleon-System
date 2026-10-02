import type { Metadata, Viewport } from 'next';
import '@/styles/staff.css';
import '@/styles/staff-extra.css';

export const metadata: Metadata = {
  title: 'BS With Leon · Academy of Business Studies by Leon Fambeck',
  manifest: '/staff/manifest.webmanifest',
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'BS With Leon' },
};

export const viewport: Viewport = { themeColor: '#ffffff' };

/* Theme before first paint (original key bswl_skel_v1_theme, default light). */
const THEME = `try{if(localStorage.getItem('bswl_skel_v1_theme')==='dark')document.body.classList.add('dark')}catch(e){}`;

export default function StaffLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-page-custom-font */}
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Poppins:wght@600;700;800&display=swap" />
      <script dangerouslySetInnerHTML={{ __html: THEME }} />
      {children}
      <script
        dangerouslySetInnerHTML={{
          __html: `if('serviceWorker' in navigator&&location.protocol==='https:')navigator.serviceWorker.register('/staff/sw.js',{scope:'/staff/'}).catch(function(){})`,
        }}
      />
    </>
  );
}
