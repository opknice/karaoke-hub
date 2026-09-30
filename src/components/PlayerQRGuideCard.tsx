'use client';

import React, { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { Check, Copy, QrCode, Sparkles } from 'lucide-react';

interface PlayerQRGuideCardProps {
  roomCode: string;
  className?: string;
  variant?: 'card' | 'compact';
}

function isLoopbackUrl(value: string): boolean {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
  } catch {
    return false;
  }
}

export const PlayerQRGuideCard: React.FC<PlayerQRGuideCardProps> = ({
  roomCode,
  className = '',
  variant = 'card',
}) => {
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'error'>('idle');
  const [qrError, setQrError] = useState<string>('');
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL ||
    (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000');
  const joinUrl = `${baseUrl.replace(/\/$/, '')}/join/${roomCode}`;
  const isLocalOnlyUrl = isLoopbackUrl(joinUrl);

  useEffect(() => {
    if (!roomCode) return;

    let cancelled = false;

    QRCode.toDataURL(joinUrl, {
      width: 240,
      margin: 1.5,
      color: {
        dark: '#09090b',
        light: '#ffffff',
      },
      })
      .then((url) => {
        if (!cancelled) {
          setQrError('');
          setQrDataUrl(url);
        }
      })
      .catch((error: unknown) => {
        console.error('Failed to generate QR in Player guide', error);
        if (!cancelled) setQrError('ไม่สามารถสร้าง QR Code ได้');
      });

    return () => {
      cancelled = true;
    };
  }, [joinUrl, roomCode]);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(joinUrl);
      setCopyStatus('copied');
    } catch {
      setCopyStatus('error');
    }

    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(() => setCopyStatus('idle'), 2500);
  };

  if (variant === 'compact') {
    return (
      <div
        className={`flex items-center justify-between gap-4 rounded-2xl border border-violet-500/30 bg-zinc-950/90 p-3 shadow-xl backdrop-blur-md ${className}`}
      >
        <div className="flex items-center gap-3">
          <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-white p-1 shadow-md">
            {qrDataUrl ? (
              <img src={qrDataUrl} alt="Scan QR to Queue" className="h-full w-full object-contain" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-[9px] text-zinc-500">
                QR...
              </div>
            )}
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-bold text-white">สแกนขอเพลงจากมือถือ</span>
              <span className="rounded bg-violet-600/30 px-1.5 py-0.5 font-mono text-[11px] font-black text-violet-300">
                {roomCode}
              </span>
            </div>
            <p className="text-[11px] text-zinc-400">
              {isLocalOnlyUrl
                ? 'ลิงก์ localhost ใช้สแกนจากมือถือไม่ได้'
                : 'ใช้กล้องมือถือ/LINE ส่อง • สั่งเพลงได้จากที่นั่ง'}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={handleCopy}
          className="shrink-0 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-zinc-300 hover:bg-white/10"
        >
          {copyStatus === 'copied'
            ? 'คัดลอกแล้ว'
            : copyStatus === 'error'
              ? 'คัดลอกไม่สำเร็จ'
              : 'คัดลอกลิงก์'}
        </button>
      </div>
    );
  }

  return (
    <div
      className={`flex flex-col justify-between overflow-hidden rounded-2xl border border-violet-500/30 bg-gradient-to-b from-zinc-900/95 to-zinc-950/95 p-4 sm:p-5 shadow-2xl backdrop-blur-xl ${className}`}
    >
      <div>
        {/* Header Badge */}
        <div className="flex items-center justify-between gap-2 border-b border-white/10 pb-3">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-tr from-pink-500 to-violet-600 text-white shadow-md shadow-pink-500/20">
              <QrCode className="h-4 w-4" />
            </span>
            <div>
              <h3 className="text-sm font-bold text-white leading-tight">ขอเพลงจากมือถือ</h3>
              <p className="text-[11px] text-zinc-400">ไม่ต้องแย่งคีย์บอร์ดหน้าจอ</p>
            </div>
          </div>
          <span
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold ${
              isLocalOnlyUrl
                ? 'border-amber-500/30 bg-amber-500/15 text-amber-300'
                : 'border-emerald-500/30 bg-emerald-500/15 text-emerald-400'
            }`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${isLocalOnlyUrl ? 'bg-amber-300' : 'bg-emerald-400 animate-pulse'}`} />
            {isLocalOnlyUrl ? 'ต้องตั้งค่า URL' : 'พร้อมใช้งาน'}
          </span>
        </div>

        {/* QR Code Presentation */}
        <div className="my-4 flex flex-col items-center text-center">
          <div className="group relative rounded-2xl bg-white p-2.5 shadow-xl shadow-violet-900/20 transition hover:scale-[1.02]">
            {qrError ? (
              <div className="flex h-36 w-36 sm:h-44 sm:w-44 items-center justify-center px-4 text-xs text-rose-600">
                {qrError}
              </div>
            ) : qrDataUrl ? (
              <img
                src={qrDataUrl}
                alt={`Room QR Code: ${roomCode}`}
                className="h-36 w-36 sm:h-44 sm:w-44 rounded-xl object-contain"
              />
            ) : (
              <div className="flex h-36 w-36 sm:h-44 sm:w-44 items-center justify-center text-xs text-zinc-400">
                กำลังสร้าง QR...
              </div>
            )}
          </div>

          {/* Big Room Code */}
          <div className="mt-3 flex items-center gap-2">
            <span className="text-[11px] font-semibold text-zinc-400">ROOM:</span>
            <span className="font-mono text-xl sm:text-2xl font-black tracking-widest text-transparent bg-clip-text bg-gradient-to-r from-pink-400 via-fuchsia-300 to-cyan-400">
              {roomCode}
            </span>
            <button
              type="button"
              onClick={handleCopy}
              title="คัดลอกลิงก์เข้าร่วมห้อง"
              className="ml-1 rounded-md p-1 text-zinc-400 hover:text-white hover:bg-white/10 transition"
            >
              {copyStatus === 'copied' ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {isLocalOnlyUrl && (
          <p role="alert" className="mb-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-200">
            QR นี้ชี้ไป localhost ซึ่งมือถือเปิดไม่ได้ กรุณาเปิด Player ผ่าน LAN IP หรือกำหนด NEXT_PUBLIC_APP_URL เป็น URL ที่มือถือเข้าถึงได้
          </p>
        )}

        {/* 3 Step Visual Guide */}
        <div className="space-y-2 rounded-xl bg-black/40 border border-white/5 p-3 text-xs">
          <div className="font-bold text-zinc-300 flex items-center gap-1.5 text-[11px]">
            <Sparkles className="h-3.5 w-3.5 text-pink-400" />
            <span>3 สเต็ปง่ายๆ สั่งเพลงทันที:</span>
          </div>

          <div className="grid gap-1.5 pl-1 text-[11px] text-zinc-300">
            <div className="flex items-center gap-2">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-violet-600/30 text-[10px] font-bold text-violet-300">
                1
              </span>
              <span>
                <strong className="text-white">สแกน QR</strong> ด้วยกล้องมือถือ หรือ LINE
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-violet-600/30 text-[10px] font-bold text-violet-300">
                2
              </span>
              <span>
                <strong className="text-white">พิมพ์ชื่อเล่น</strong> แล้วกดเข้าร่วม
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-violet-600/30 text-[10px] font-bold text-violet-300">
                3
              </span>
              <span>
                <strong className="text-white">เลือกเพลง</strong> แล้วส่งเข้าคิวได้เลย!
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Trust Badge / Footer note */}
      <div className="mt-4 pt-3 border-t border-white/5 flex items-center justify-center gap-2 text-[10px] font-medium text-zinc-400">
        <span>✨ ไม่ต้องโหลดแอป</span>
        <span>•</span>
        <span>ฟรี 100%</span>
        <span>•</span>
        <span>สั่งได้จากที่นั่ง</span>
      </div>
    </div>
  );
};
