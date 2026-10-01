'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { User } from '@/lib/types';
import { getSupabaseBrowserClient, isSupabaseConfigured } from '@/lib/supabase/client';

interface AuthContextType {
  user: User | null;
  nickname: string;
  setNickname: (name: string) => void;
  isConfigured: boolean;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [nickname, setNicknameState] = useState<string>('Singer');
  const isConfigured = isSupabaseConfigured();

  useEffect(() => {
    // Load stored nickname
    const storedNickname = localStorage.getItem('karaoke_user_nickname');
    if (storedNickname) {
      // Browser storage is unavailable to the server render, so hydrate it here.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setNicknameState(storedNickname);
    }

    if (isConfigured) {
      const supabase = getSupabaseBrowserClient();
      if (supabase) {
        supabase.auth.getUser().then(({ data: { user: authUser } }) => {
          if (authUser) {
            setUser({
              id: authUser.id,
              email: authUser.email || '',
              display_name: authUser.user_metadata?.display_name || authUser.email?.split('@')[0] || 'User',
              avatar_url: authUser.user_metadata?.avatar_url,
              created_at: authUser.created_at,
            });
            if (authUser.user_metadata?.display_name) {
              setNicknameState(authUser.user_metadata.display_name);
            }
          }
        });

        const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
          if (session?.user) {
            setUser({
              id: session.user.id,
              email: session.user.email || '',
              display_name: session.user.user_metadata?.display_name || session.user.email?.split('@')[0] || 'User',
              avatar_url: session.user.user_metadata?.avatar_url,
              created_at: session.user.created_at,
            });
          } else {
            setUser(null);
          }
        });

        return () => {
          authListener?.subscription.unsubscribe();
        };
      }
    } else {
      // Standalone mode demo user
      const savedUser = localStorage.getItem('karaoke_demo_user');
      if (savedUser) {
        setUser(JSON.parse(savedUser));
      } else {
        const demoUser: User = {
          id: 'demo-user-1',
          email: 'singer@karaoke.party',
          display_name: 'Karaoke Star 🌟',
          created_at: new Date().toISOString(),
        };
        setUser(demoUser);
      }
    }
  }, [isConfigured]);

  const setNickname = (name: string) => {
    const trimmed = name.trim() || 'Singer';
    setNicknameState(trimmed);
    localStorage.setItem('karaoke_user_nickname', trimmed);
    if (user) {
      setUser({ ...user, display_name: trimmed });
    }
  };

  const signInWithGoogle = async () => {
    const supabase = getSupabaseBrowserClient();
    if (supabase) {
      await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
        },
      });
    } else {
      alert('Supabase is not configured yet. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local to enable cloud login.');
    }
  };

  const signOut = async () => {
    const supabase = getSupabaseBrowserClient();
    if (supabase) {
      await supabase.auth.signOut();
    }
    setUser(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        nickname,
        setNickname,
        isConfigured,
        signInWithGoogle,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
