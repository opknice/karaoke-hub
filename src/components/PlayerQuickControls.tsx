'use client';

import { ListMusic, Loader2, Maximize2, Minimize2, RotateCcw, SkipForward } from 'lucide-react';
import styles from './PlayerQuickControls.module.css';

interface PlayerQuickControlsProps {
  hasSong: boolean;
  endingSong: boolean;
  queueOpen: boolean;
  fullscreenActive: boolean;
  fullscreenPending: boolean;
  fullscreenLabel: string;
  onRestart: () => void;
  onEnd: () => void;
  onToggleQueue: () => void;
  onToggleFullscreen: () => void;
}

export function PlayerQuickControls({ hasSong, endingSong, queueOpen, fullscreenActive,
  fullscreenPending, fullscreenLabel, onRestart, onEnd, onToggleQueue, onToggleFullscreen }: PlayerQuickControlsProps) {
  const queueLabel = queueOpen ? 'ปิดเพลงในคิว' : 'เปิดเพลงในคิว';
  return (
    <div role="group" aria-label="ควบคุมการเล่นเพลง" data-player-controls className={styles.toolbar}>
      <button type="button" className={styles.button} aria-label="เล่นซ้ำ" title="เล่นซ้ำ (Home)"
        disabled={!hasSong || endingSong} onClick={onRestart}>
        <RotateCcw aria-hidden="true" />
      </button>
      <button type="button" className={styles.button} aria-label="จบเพลง" title="จบเพลงและไปเพลงถัดไป (End)"
        disabled={!hasSong || endingSong} aria-busy={endingSong} onClick={onEnd}>
        {endingSong ? <Loader2 aria-hidden="true" className="animate-spin" /> : <SkipForward aria-hidden="true" />}
      </button>
      <button type="button" className={styles.button} aria-label={queueLabel} title={`${queueLabel} (↑↓)`}
        aria-controls="player-queue-results" aria-expanded={queueOpen} onClick={onToggleQueue}>
        <ListMusic aria-hidden="true" />
      </button>
      <button type="button" className={styles.button} aria-label={fullscreenLabel} title={fullscreenLabel}
        aria-pressed={fullscreenActive} aria-busy={fullscreenPending} disabled={fullscreenPending} onClick={onToggleFullscreen}>
        {fullscreenPending ? <Loader2 aria-hidden="true" className="animate-spin" />
          : fullscreenActive ? <Minimize2 aria-hidden="true" /> : <Maximize2 aria-hidden="true" />}
      </button>
    </div>
  );
}
