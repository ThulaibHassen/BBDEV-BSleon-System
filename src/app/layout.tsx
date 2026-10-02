import type { Metadata, Viewport } from 'next';

/* The root is deliberately bare. Each of the three apps (staff, student,
   parent) brings its own stylesheet, manifest, theme script and service
   worker through its own layout, exactly like the three separate files the
   system used to be. Moving between apps is a full page load, so one app's
   :root tokens never bleed into another's. */

export const metadata: Metadata = {
  title: 'BS With Leon · Academy of Business Studies by Leon Fambeck',
  robots: { index: false, follow: false, nocache: true },
  icons: { apple: '/apple-touch-icon.png' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
