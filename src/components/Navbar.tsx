'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useKaraoke } from '@/context/KaraokeContext';
import { useAuth } from '@/context/AuthContext';
import {
  Mic,
  Search,
  ListMusic,
  Heart,
  History,
  Users,
  Tv,
  Menu,
  X,
  Sparkles,
  Radio,
} from 'lucide-react';

export const Navbar: React.FC = () => {
  const pathname = usePathname();
  const { queue, nowPlaying, activeRoom } = useKaraoke();
  const { nickname, setNickname } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [editingNickname, setEditingNickname] = useState(false);
  const [tempNickname, setTempNickname] = useState(nickname);

  const navLinks = [
    { name: 'Discover', href: '/', icon: Sparkles },
    { name: 'Search', href: '/search', icon: Search },
    {
      name: 'Queue',
      href: '/queue',
      icon: ListMusic,
      badge: queue.length > 0 ? queue.length : undefined,
    },
    { name: 'Playlists', href: '/playlists', icon: ListMusic },
    { name: 'Favorites', href: '/favorites', icon: Heart },
    { name: 'History', href: '/history', icon: History },
    {
      name: 'Party Room',
      href: activeRoom ? `/room/${activeRoom.room_code}` : '/party',
      icon: Users,
      highlight: Boolean(activeRoom),
    },
  ];

  const handleSaveNickname = (e: React.FormEvent) => {
    e.preventDefault();
    setNickname(tempNickname);
    setEditingNickname(false);
  };

  return (
    <header className="sticky top-0 z-40 w-full border-b border-zinc-800/80 bg-zinc-950/85 backdrop-blur-xl">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2.5 group">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-violet-600 via-fuchsia-600 to-pink-500 p-[1px] shadow-lg shadow-violet-500/20 group-hover:scale-105 transition">
            <div className="w-full h-full bg-zinc-950 rounded-[11px] flex items-center justify-center">
              <Mic className="w-5 h-5 text-fuchsia-400 group-hover:rotate-6 transition" />
            </div>
          </div>
          <div>
            <div className="text-lg font-black tracking-tight bg-gradient-to-r from-white via-zinc-100 to-zinc-400 bg-clip-text text-transparent">
              KARAOKE<span className="text-pink-500">.</span>HUB
            </div>
            <div className="text-[10px] tracking-wider text-zinc-400 uppercase font-semibold">
              Session & Queue Manager
            </div>
          </div>
        </Link>

        {/* Desktop Navigation */}
        <nav className="hidden md:flex items-center gap-1">
          {navLinks.map((link) => {
            const Icon = link.icon;
            const isActive = pathname === link.href;
            return (
              <Link
                key={link.name}
                href={link.href}
                className={`relative px-3.5 py-2 rounded-xl text-sm font-medium flex items-center gap-2 transition ${
                  isActive
                    ? 'text-white bg-zinc-800/80 shadow-sm border border-zinc-700/60'
                    : 'text-zinc-400 hover:text-white hover:bg-zinc-900/60'
                } ${link.highlight ? 'ring-1 ring-pink-500/40 text-pink-300' : ''}`}
              >
                <Icon className={`w-4 h-4 ${isActive ? 'text-pink-400' : ''}`} />
                <span>{link.name}</span>
                {link.badge !== undefined && (
                  <span className="px-1.5 py-0.2 text-[11px] font-bold rounded-full bg-violet-600 text-white leading-none">
                    {link.badge}
                  </span>
                )}
                {link.highlight && (
                  <span className="w-2 h-2 rounded-full bg-pink-500 animate-ping absolute -top-0.5 -right-0.5" />
                )}
              </Link>
            );
          })}
        </nav>

        {/* Right Action Area */}
        <div className="hidden sm:flex items-center gap-3">
          {/* TV Screen Button */}
          <Link
            href="/player"
            className="px-3 py-1.5 rounded-xl bg-gradient-to-r from-violet-600/30 to-fuchsia-600/30 hover:from-violet-600/50 hover:to-fuchsia-600/50 border border-violet-500/30 text-white text-xs font-semibold flex items-center gap-2 transition shadow-sm hover:shadow-violet-500/20"
            title="Open Display Screen for TV or Projector"
          >
            <Tv className="w-3.5 h-3.5 text-cyan-400" />
            <span>TV Display</span>
            {nowPlaying && <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />}
          </Link>

          {/* Singer Nickname Indicator */}
          {editingNickname ? (
            <form onSubmit={handleSaveNickname} className="flex items-center gap-1.5">
              <input
                type="text"
                value={tempNickname}
                onChange={(e) => setTempNickname(e.target.value)}
                className="w-28 px-2 py-1 text-xs rounded-lg bg-zinc-900 border border-violet-500 text-white focus:outline-none"
                autoFocus
                onBlur={() => setEditingNickname(false)}
              />
            </form>
          ) : (
            <button
              onClick={() => {
                setTempNickname(nickname);
                setEditingNickname(true);
              }}
              className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-zinc-900/80 border border-zinc-800 hover:border-zinc-700 text-zinc-300 hover:text-white text-xs font-medium transition"
              title="Click to change your singer nickname"
            >
              <div className="w-5 h-5 rounded-full bg-gradient-to-tr from-pink-500 to-violet-500 flex items-center justify-center text-[10px] font-bold text-white">
                {nickname.charAt(0).toUpperCase()}
              </div>
              <span className="max-w-[100px] truncate">{nickname}</span>
            </button>
          )}
        </div>

        {/* Mobile menu trigger */}
        <div className="flex md:hidden items-center gap-2">
          <Link
            href="/player"
            className="p-2 rounded-xl bg-zinc-900 text-zinc-300 hover:text-white border border-zinc-800"
          >
            <Tv className="w-4 h-4 text-cyan-400" />
          </Link>
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="p-2 rounded-xl bg-zinc-900 text-zinc-400 hover:text-white border border-zinc-800"
          >
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="md:hidden border-t border-zinc-800 bg-zinc-950 p-4 space-y-2 animate-in slide-in-from-top-2">
          {navLinks.map((link) => {
            const Icon = link.icon;
            const isActive = pathname === link.href;
            return (
              <Link
                key={link.name}
                href={link.href}
                onClick={() => setMobileMenuOpen(false)}
                className={`flex items-center justify-between px-4 py-3 rounded-xl text-sm font-medium transition ${
                  isActive ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:bg-zinc-900 hover:text-white'
                }`}
              >
                <div className="flex items-center gap-3">
                  <Icon className="w-4 h-4 text-pink-400" />
                  <span>{link.name}</span>
                </div>
                {link.badge !== undefined && (
                  <span className="px-2 py-0.5 text-xs font-bold rounded-full bg-violet-600 text-white">
                    {link.badge}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      )}
    </header>
  );
};
