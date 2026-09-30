'use client';

import { useEffect, useState } from 'react';

export function SearchBudgetNotice() {
  const [message, setMessage] = useState('');
  const [warning, setWarning] = useState('');
  useEffect(() => {
    const onBudget = (event: Event) => {
      if (!(event instanceof CustomEvent)) return;
      const value: unknown = event.detail;
      if (typeof value !== 'object' || value === null || !('used' in value) || !('limit' in value)) return;
      if (typeof value.used !== 'number' || typeof value.limit !== 'number') return;
      const upstreamExhausted = 'upstreamExhausted' in value && value.upstreamExhausted === true;
      setMessage(`แอปส่งคำขอค้นหาวันนี้ ${value.used}/${value.limit} ครั้ง${upstreamExhausted ? ' • YouTube แจ้งว่าโควตาโปรเจกต์เต็มแล้ว' : value.used >= value.limit * 0.8 ? ' • ใกล้ครบงบ แนะนำเลือกเพลงที่บันทึกไว้' : ''} (ไม่รวมการใช้งานก่อนติดตั้งตัวนับหรือจากแอปอื่น)`);
    };
    const onWarning = (event: Event) => {
      if (event instanceof CustomEvent && typeof event.detail === 'string') setWarning(event.detail);
    };
    window.addEventListener('karaoke-search-budget', onBudget);
    window.addEventListener('karaoke-search-warning', onWarning);
    return () => {
      window.removeEventListener('karaoke-search-budget', onBudget);
      window.removeEventListener('karaoke-search-warning', onWarning);
    };
  }, []);
  return message || warning ? <p role="status" className="my-2 rounded-lg bg-zinc-950/90 px-3 py-2 text-xs text-amber-200">{message}{warning && <span className="block">{warning}</span>}</p> : null;
}
