import { ArrowUpRight, Keyboard, ListMusic, Mic2, Music2, Smartphone, Sparkles, Users } from 'lucide-react';
import { PlayerQRGuideCard } from './PlayerQRGuideCard';
import styles from './PlayerIdleGuide.module.css';

export function PlayerIdleWelcome({ memberCount, queueCount }: { memberCount: number; queueCount: number }) {
  return (
    <header className={styles.welcome}>
      <div className={styles.brand}><Mic2 aria-hidden="true" /> KARAOKE.HUB</div>
      <div className={styles.hero}>
        <div className={styles.heroCopy}>
          <p className={styles.ready}>YOUR STAGE. YOUR SONG.</p>
          <h1>เวทีนี้<br /><span>รอเสียงคุณ</span></h1>
          <p className={styles.lead}>เพลงที่ชอบ เสียงที่ใช่ คืนนี้คุณเลือกเอง<br />คีย์เพลงตรงนี้ หรือสแกนจากที่นั่งได้เลย</p>
        </div>
        <div className={styles.micStage} aria-hidden="true">
          <div className={styles.spotlight} />
          <div className={`${styles.spotlight} ${styles.spotlightCyan}`} />
          <div className={styles.stageHalo} />
          <div className={styles.stageBars}>
            {Array.from({ length: 11 }, (_, index) => (
              <span key={index} style={{ animationDelay: `${index * -0.31}s` }} />
            ))}
          </div>
          <div className={styles.micRing} />
          <div className={`${styles.micRing} ${styles.outerRing}`} />
          <div className={styles.orbit}><span /><span /></div>
          <div className={styles.micFloat}><Mic2 className={styles.heroMic} strokeWidth={1.25} /></div>
          <span className={styles.micCaption}>THE MIC IS YOURS</span>
          <span className={styles.musicNote}><Music2 /></span>
          <span className={styles.spark}><Sparkles /></span>
          <span className={styles.secondNote}><Music2 /></span>
        </div>
      </div>
      <div className={styles.roomStats} aria-live="polite" aria-atomic="true">
        <span><Users aria-hidden="true" /><b>{memberCount}</b> คนเข้าร่วมห้อง</span>
        <span><ListMusic aria-hidden="true" /><b>{queueCount}</b> เพลงรอในคิว</span>
        <span className={styles.invitation}>{queueCount ? 'เพลงต่อไป… ให้คุณเลือก' : 'ใครจะเป็นคนเปิดเพลงแรก?'}</span>
      </div>
    </header>
  );
}

export function PlayerIdleKeyboardHeading() {
  return (
    <div className={styles.keyboardHeading}>
      <p className={styles.method}>01 / ใช้คีย์บอร์ดตรงหน้า</p>
      <h2><Keyboard aria-hidden="true" /> เพลงแรกของคืนนี้ คุณเลือกเลย</h2>
      <p>มีเพลงในใจ? พิมพ์ชื่อเพลงหรือศิลปินในช่องนี้</p>
    </div>
  );
}

export function PlayerIdleKeyboardHints({ onPopular, onLyrics }: { onPopular: () => void; onLyrics: () => void }) {
  return (
    <div className={styles.hints}>
      <span><kbd>พิมพ์</kbd> ค้นหาเพลง</span>
      <span><kbd>↑ ↓</kbd> เลือกเพลง</span>
      <span><kbd>Enter</kbd> เพิ่มเพลงที่เลือกเข้าคิว</span>
      <div className={styles.discovery}>
        <p>ยังนึกเพลงไม่ออก? เริ่มตรงนี้</p>
        <button type="button" onClick={onPopular}><Sparkles aria-hidden="true" /><span>หาเพลงยอดนิยม</span><ArrowUpRight aria-hidden="true" /></button>
        <button type="button" data-player-lyrics-ui onClick={onLyrics}><Music2 aria-hidden="true" /><span>รู้เนื้อ แต่จำชื่อไม่ได้</span><ArrowUpRight aria-hidden="true" /></button>
      </div>
    </div>
  );
}

export function PlayerIdleRoom({ roomCode }: { roomCode?: string }) {
  return (
    <aside className={styles.room} aria-label="เลือกเพลงผ่านมือถือ">
      <p className={styles.method}>02 / เลือกจากที่นั่ง</p>
      <div className={styles.mobileHeading}><Smartphone aria-hidden="true" /><h2>เพลงต่อไป อยู่ในมือคุณ</h2></div>
      <p>หยิบมือถือขึ้นมา แล้วสแกนเลย</p>
      {roomCode ? <PlayerQRGuideCard roomCode={roomCode} className={styles.qrCard} /> : (
        <div className={styles.pending} role="status">กำลังเตรียมห้องและ QR Code<br /><span>ระหว่างนี้พิมพ์ค้นหาเพลงได้เลย</span></div>
      )}
    </aside>
  );
}
