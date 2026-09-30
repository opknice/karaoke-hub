'use client';

import React, { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useKaraoke } from '@/context/KaraokeContext';
import PartyPage from '@/app/party/page';

export default function RoomPage() {
  const params = useParams();
  const roomCode = ((params?.code as string) || '').toUpperCase();
  const { activeRoom, joinRoom } = useKaraoke();

  useEffect(() => {
    if (roomCode && (!activeRoom || activeRoom.room_code !== roomCode)) {
      joinRoom(roomCode, 'Host');
    }
  }, [roomCode, activeRoom, joinRoom]);

  return <PartyPage />;
}
