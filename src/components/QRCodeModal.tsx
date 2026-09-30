'use client';

import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { X, Copy, Check, QrCode, ExternalLink, Share2 } from 'lucide-react';

interface QRCodeModalProps {
  roomCode: string;
  roomName: string;
  onClose: () => void;
}

export const QRCodeModal: React.FC<QRCodeModalProps> = ({ roomCode, roomName, onClose }) => {
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [copied, setCopied] = useState<boolean>(false);

  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL ||
    (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000');
  const joinUrl = `${baseUrl.replace(/\/$/, '')}/join/${roomCode}`;

  useEffect(() => {
    QRCode.toDataURL(joinUrl, {
      width: 320,
      margin: 2,
      color: {
        dark: '#000000',
        light: '#ffffff',
      },
    })
      .then((url) => setQrDataUrl(url))
      .catch((err) => console.error('Failed to generate QR code', err));
  }, [joinUrl]);

  const handleCopy = () => {
    navigator.clipboard.writeText(joinUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-200">
      <div className="w-full max-w-sm rounded-3xl bg-zinc-950 border border-zinc-800 p-6 shadow-2xl relative text-white text-center">
        <button
          onClick={onClose}
          className="absolute top-5 right-5 p-2 rounded-full text-zinc-400 hover:text-white hover:bg-zinc-900 transition"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Title */}
        <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-cyan-500 to-violet-500 mx-auto flex items-center justify-center shadow-lg shadow-cyan-500/20 mb-3">
          <QrCode className="w-6 h-6 text-white" />
        </div>
        <h3 className="text-xl font-black text-white">{roomName}</h3>
        <p className="text-xs text-zinc-400 mt-1">Scan QR Code or enter Room Code on phone to request songs</p>

        {/* Big Room Code Box */}
        <div className="my-5 p-3 rounded-2xl bg-zinc-900/90 border border-zinc-800">
          <div className="text-[11px] font-bold text-zinc-400 uppercase tracking-widest">Party Room Code</div>
          <div className="text-4xl font-black tracking-widest text-transparent bg-clip-text bg-gradient-to-r from-pink-400 via-fuchsia-400 to-cyan-400 mt-1">
            {roomCode}
          </div>
        </div>

        {/* QR Code Container */}
        <div className="bg-white p-3 rounded-2xl inline-block shadow-xl shadow-cyan-500/10 mb-4">
          {qrDataUrl ? (
            <img src={qrDataUrl} alt="Room QR Code" className="w-56 h-56 mx-auto rounded-xl" />
          ) : (
            <div className="w-56 h-56 flex items-center justify-center text-zinc-400 text-sm">Generating QR...</div>
          )}
        </div>

        {/* Join Link & Copy */}
        <div className="flex items-center gap-2 p-1.5 rounded-xl bg-zinc-900 border border-zinc-800">
          <input
            type="text"
            readOnly
            value={joinUrl}
            className="flex-1 bg-transparent px-2 text-xs text-zinc-300 truncate focus:outline-none"
          />
          <button
            onClick={handleCopy}
            className="px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold flex items-center gap-1.5 transition"
          >
            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copied ? 'Copied!' : 'Copy'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
