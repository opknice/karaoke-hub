import type { Metadata } from 'next';
import { Outfit, Plus_Jakarta_Sans } from 'next/font/google';
import './globals.css';
import { KaraokeProvider } from '@/context/KaraokeContext';
import { AuthProvider } from '@/context/AuthContext';
import { AppShell } from '@/components/AppShell';

const fontSans = Plus_Jakarta_Sans({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
});

const fontDisplay = Outfit({
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Karaoke Playlist Manager — Sing, Queue, Party Together',
  description:
    'A collaborative karaoke session manager powered by YouTube. Search karaoke tracks, manage singer rotation, host party rooms, and queue your favorite songs with friends.',
  keywords: ['karaoke', 'youtube karaoke', 'karaoke player', 'karaoke queue', 'party room', 'singer rotation'],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${fontSans.variable} ${fontDisplay.variable} dark h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-zinc-950 text-zinc-100 font-sans selection:bg-pink-500/30 selection:text-pink-200">
        <AuthProvider>
          <KaraokeProvider>
            <AppShell>{children}</AppShell>
          </KaraokeProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
