'use client';

import { usePathname } from 'next/navigation';
import { FloatingPlayer } from '@/components/FloatingPlayer';
import { Navbar } from '@/components/Navbar';
import { RatingModal } from '@/components/RatingModal';

interface AppShellProps {
  children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const pathname = usePathname();
  const isImmersivePlayer = pathname === '/player';

  return (
    <div
      className={
        isImmersivePlayer
          ? 'relative h-dvh overflow-hidden bg-black'
          : 'relative min-h-screen flex flex-col'
      }
    >
      {!isImmersivePlayer && (
        <>
          <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden" aria-hidden="true">
            <div className="absolute -top-40 -left-40 w-96 h-96 bg-violet-600/10 rounded-full blur-[128px]" />
            <div className="absolute top-1/3 -right-40 w-96 h-96 bg-pink-600/10 rounded-full blur-[128px]" />
            <div className="absolute -bottom-40 left-1/3 w-96 h-96 bg-cyan-600/10 rounded-full blur-[128px]" />
          </div>
          <Navbar />
        </>
      )}

      <main
        className={
          isImmersivePlayer
            ? 'relative h-dvh w-full overflow-hidden bg-black'
            : 'relative z-10 flex-1 flex flex-col pb-24'
        }
      >
        {children}
      </main>

      {!isImmersivePlayer && (
        <>
          <FloatingPlayer />
          <RatingModal />
        </>
      )}
    </div>
  );
}
