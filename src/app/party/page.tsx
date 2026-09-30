'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useKaraoke } from '@/context/KaraokeContext';
import { useAuth } from '@/context/AuthContext';
import { QRCodeModal } from '@/components/QRCodeModal';
import {
  Users,
  Plus,
  QrCode,
  Tv,
  CheckCircle,
  XCircle,
  Clock,
  Lock,
  Unlock,
  Sliders,
  Sparkles,
} from 'lucide-react';
import Link from 'next/link';

export default function PartyPage() {
  const router = useRouter();
  const {
    activeRoom,
    createRoom,
    leaveRoom,
    pendingRequests,
    approveRequest,
    rejectRequest,
    roomMembers,
    isQueueLocked,
    setIsQueueLocked,
  } = useKaraoke();
  const { nickname } = useAuth();

  const [roomNameInput, setRoomNameInput] = useState(`${nickname}'s Karaoke Party 🎉`);
  const [showQRModal, setShowQRModal] = useState(false);
  const [manualCode, setManualCode] = useState('');
  const [isCreatingRoom, setIsCreatingRoom] = useState(false);
  const [createRoomError, setCreateRoomError] = useState('');

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsCreatingRoom(true);
    setCreateRoomError('');
    try {
      await createRoom(roomNameInput);
      setShowQRModal(true);
    } catch (error: unknown) {
      setCreateRoomError(
        error instanceof Error ? error.message : 'ไม่สามารถสร้างห้องได้ กรุณาลองใหม่'
      );
    } finally {
      setIsCreatingRoom(false);
    }
  };

  const handleJoinManual = (e: React.FormEvent) => {
    e.preventDefault();
    if (manualCode.trim()) {
      router.push(`/join/${manualCode.trim().toUpperCase()}`);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full flex-1 flex flex-col">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black text-white flex items-center gap-2.5">
            <Users className="w-7 h-7 text-pink-500" />
            <span>Karaoke Party Lounge</span>
          </h1>
          <p className="text-xs sm:text-sm text-zinc-400 mt-1">
            Host a collaborative room where guests scan QR codes on their phone to request songs.
          </p>
        </div>

        {activeRoom && (
          <div className="flex items-center gap-2 self-start sm:self-auto">
            <button
              onClick={() => setShowQRModal(true)}
              className="px-4 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-semibold text-xs flex items-center gap-2 shadow-lg shadow-violet-600/30 transition"
            >
              <QrCode className="w-4 h-4" />
              <span>Show TV QR Code</span>
            </button>

            <Link
              href="/player"
              className="px-4 py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-white font-semibold text-xs flex items-center gap-2 transition"
            >
              <Tv className="w-4 h-4 text-cyan-400" />
              <span>TV Screen</span>
            </Link>
          </div>
        )}
      </div>

      {!activeRoom ? (
        /* Create or Join Room UI */
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 my-auto max-w-4xl mx-auto w-full">
          {/* Create Room Box */}
          <div className="rounded-3xl bg-zinc-900/60 border border-zinc-800 p-6 sm:p-8 flex flex-col justify-between shadow-2xl relative overflow-hidden">
            <div className="space-y-4">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-violet-600 to-pink-500 flex items-center justify-center text-white shadow-lg">
                <Sparkles className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-xl font-bold text-white">Host a New Room</h3>
                <p className="text-xs text-zinc-400 mt-1">
                  You control the TV display, approve guest requests, and manage queue rotation.
                </p>
              </div>

              <form onSubmit={handleCreate} className="space-y-3 pt-2">
                <div>
                  <label className="text-xs font-semibold text-zinc-300 block mb-1">Room Name</label>
                  <input
                    type="text"
                    value={roomNameInput}
                    onChange={(e) => {
                      setRoomNameInput(e.target.value);
                      if (createRoomError) setCreateRoomError('');
                    }}
                    placeholder="e.g. John's Friday Party"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-zinc-950 border border-zinc-800 text-white text-sm focus:outline-none focus:border-violet-500"
                    required
                    maxLength={80}
                  />
                </div>

                {createRoomError && (
                  <p role="alert" className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
                    {createRoomError}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={isCreatingRoom || !roomNameInput.trim()}
                  className="w-full py-3 rounded-xl bg-gradient-to-r from-violet-600 to-pink-600 hover:from-violet-500 hover:to-pink-500 disabled:cursor-wait disabled:opacity-60 text-white font-semibold text-sm shadow-lg shadow-violet-600/30 transition flex items-center justify-center gap-2"
                >
                  <Plus className="w-4 h-4" />
                  <span>{isCreatingRoom ? 'Creating room…' : 'Create Room & Generate QR'}</span>
                </button>
              </form>
            </div>
          </div>

          {/* Join Existing Room Box */}
          <div className="rounded-3xl bg-zinc-900/40 border border-zinc-800 p-6 sm:p-8 flex flex-col justify-between shadow-xl">
            <div className="space-y-4">
              <div className="w-12 h-12 rounded-2xl bg-zinc-800 text-cyan-400 flex items-center justify-center shadow-lg">
                <QrCode className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-xl font-bold text-white">Join as Guest</h3>
                <p className="text-xs text-zinc-400 mt-1">
                  Got a Room Code from your friend or TV screen? Enter it below to request songs.
                </p>
              </div>

              <form onSubmit={handleJoinManual} className="space-y-3 pt-2">
                <div>
                  <label className="text-xs font-semibold text-zinc-300 block mb-1">6-Letter Room Code</label>
                  <input
                    type="text"
                    value={manualCode}
                    onChange={(e) => setManualCode(e.target.value.toUpperCase())}
                    placeholder="e.g. ROCK88"
                    maxLength={8}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-zinc-950 border border-zinc-800 text-white uppercase tracking-widest text-base font-mono font-bold focus:outline-none focus:border-cyan-500 text-center"
                    required
                  />
                </div>

                <button
                  type="submit"
                  className="w-full py-3 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-white font-semibold text-sm transition flex items-center justify-center gap-2"
                >
                  <span>Join Party</span>
                </button>
              </form>
            </div>
          </div>
        </div>
      ) : (
        /* Active Host Room Dashboard */
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 flex-1">
          {/* Left Column: Room Overview, Requests, Queue Controls */}
          <div className="lg:col-span-2 space-y-6">
            {/* Room Status Card */}
            <div className="p-6 rounded-3xl bg-gradient-to-r from-violet-950/70 via-zinc-900 to-pink-950/70 border border-violet-500/30 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 text-xs font-bold border border-emerald-500/30 mb-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  <span>Room Active</span>
                </div>
                <h2 className="text-xl sm:text-2xl font-black text-white">{activeRoom.name}</h2>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-xs text-zinc-400">Room Code:</span>
                  <span className="text-base font-black tracking-wider text-pink-400 font-mono">
                    {activeRoom.room_code}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowQRModal(true)}
                  className="px-3.5 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold flex items-center gap-1.5 transition shadow"
                >
                  <QrCode className="w-4 h-4" />
                  <span>QR Code</span>
                </button>

                <button
                  onClick={leaveRoom}
                  className="px-3.5 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-semibold transition"
                >
                  Close Room
                </button>
              </div>
            </div>

            {/* Pending Guest Requests (Spec Section 14) */}
            <div className="rounded-3xl bg-zinc-900/50 border border-zinc-800 p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-amber-400" />
                  <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                    Guest Song Requests ({pendingRequests.length})
                  </h3>
                </div>
              </div>

              {pendingRequests.length === 0 ? (
                <div className="py-8 text-center text-xs text-zinc-500">
                  No pending song requests. Guests can scan the QR code to submit songs!
                </div>
              ) : (
                <div className="space-y-3">
                  {pendingRequests.map((req) => (
                    <div
                      key={req.id}
                      className="p-3.5 rounded-2xl bg-zinc-950/80 border border-zinc-800 flex items-center justify-between gap-4"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <img
                          src={req.video.thumbnail_url}
                          alt={req.video.title}
                          className="w-16 h-11 rounded-xl object-cover shrink-0"
                        />
                        <div className="min-w-0">
                          <h4 className="text-xs font-semibold text-white truncate">{req.video.title}</h4>
                          <p className="text-[11px] text-zinc-400">
                            Requested by: <span className="text-cyan-400 font-semibold">{req.requested_by}</span>
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          onClick={() => approveRequest(req.id)}
                          className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center gap-1"
                        >
                          <CheckCircle className="w-3.5 h-3.5" />
                          <span>Approve</span>
                        </button>
                        <button
                          onClick={() => rejectRequest(req.id)}
                          className="p-1.5 rounded-xl bg-zinc-800 hover:bg-rose-950 text-zinc-400 hover:text-rose-400"
                        >
                          <XCircle className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Right Column: Active Members List & Quick Settings */}
          <div className="lg:col-span-1 space-y-6">
            {/* Active Members */}
            <div className="rounded-3xl bg-zinc-900/60 border border-zinc-800 p-6">
              <div className="flex items-center gap-2 mb-4">
                <Users className="w-4 h-4 text-violet-400" />
                <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                  Party Singers ({roomMembers.length})
                </h3>
              </div>

              <div className="space-y-2">
                {roomMembers.map((member) => (
                  <div
                    key={member.id}
                    className="p-2.5 rounded-xl bg-zinc-950/60 border border-zinc-800/80 flex items-center justify-between text-xs"
                  >
                    <div className="flex items-center gap-2.5">
                      <div className="w-7 h-7 rounded-lg bg-gradient-to-tr from-violet-600 to-pink-600 flex items-center justify-center text-white font-bold text-[11px]">
                        {member.nickname.charAt(0).toUpperCase()}
                      </div>
                      <span className="font-semibold text-zinc-200">{member.nickname}</span>
                    </div>
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${
                        member.role === 'host'
                          ? 'bg-violet-950 text-violet-300 border border-violet-500/40'
                          : 'bg-zinc-800 text-zinc-400'
                      }`}
                    >
                      {member.role === 'host' ? 'HOST' : 'GUEST'}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Room Controls */}
            <div className="rounded-3xl bg-zinc-900/60 border border-zinc-800 p-6 space-y-4">
              <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                <Sliders className="w-4 h-4 text-pink-400" />
                <span>Room Rules</span>
              </h3>

              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs font-semibold text-white">Queue Open</div>
                  <div className="text-[11px] text-zinc-400">Allow guests to add songs</div>
                </div>
                <button
                  onClick={() => setIsQueueLocked(!isQueueLocked)}
                  className={`p-2 rounded-xl transition ${
                    isQueueLocked ? 'bg-zinc-800 text-zinc-400' : 'bg-emerald-600 text-white'
                  }`}
                >
                  {isQueueLocked ? <Lock className="w-4 h-4" /> : <Unlock className="w-4 h-4" />}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* QR Code Modal */}
      {showQRModal && activeRoom && (
        <QRCodeModal
          roomCode={activeRoom.room_code}
          roomName={activeRoom.name}
          onClose={() => setShowQRModal(false)}
        />
      )}
    </div>
  );
}
