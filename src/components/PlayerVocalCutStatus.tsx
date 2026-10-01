'use client';

import { AlertTriangle, Gauge, MicOff, Radio, Star } from 'lucide-react';
import type {
  VocalCutExtensionState,
  VocalCutPreset,
  VocalCutResult,
} from '@/lib/vocal-cut-bridge';

interface PlayerVocalCutStatusProps {
  state: VocalCutExtensionState;
  notice: string | null;
  hasRequestedFeedback: boolean;
  hasSong: boolean;
  onToggle: () => void;
  onSubmitResult: (result: VocalCutResult) => void;
  onPresetChange: (preset: VocalCutPreset) => void;
  showNormalizeFeedback: boolean;
  normalizeFeedbackFading: boolean;
}

const RESULT_LABELS: Record<VocalCutResult, string> = {
  good: 'ใช้ได้ดี',
  fair: 'พอใช้',
  bad: 'ใช้ไม่ได้',
};

const PRESET_LABELS: Record<VocalCutPreset, string> = {
  balanced: 'Balanced',
  strong: 'Strong',
  maximum: 'Maximum',
};

function getStatusPresentation(state: VocalCutExtensionState) {
  switch (state.captureStatus) {
    case 'capturing_vocal_cut':
      return {
        label: 'VOCAL CUT: ON',
        detail: 'กด * เพื่อกลับเสียงเดิม',
        className: 'border-fuchsia-400/50 bg-fuchsia-950/90 text-fuchsia-50',
        icon: MicOff,
      };
    case 'capturing_original':
      return {
        label: 'VOCAL CUT: OFF',
        detail: 'กด * เพื่อลดเสียงกลาง',
        className: 'border-cyan-400/35 bg-zinc-950/90 text-cyan-50',
        icon: Radio,
      };
    case 'starting':
      return {
        label: 'กำลังเชื่อมต่อเสียง…',
        detail: 'กรุณารอสักครู่',
        className: 'border-cyan-400/30 bg-zinc-950/90 text-zinc-100',
        icon: Radio,
      };
    case 'unsupported_mono':
      return {
        label: 'สัญญาณเสียงมี Stereo จำกัด',
        detail: 'ยังทดลองเปิด Vocal Cut ได้',
        className: 'border-amber-400/45 bg-amber-950/90 text-amber-50',
        icon: AlertTriangle,
      };
    case 'error':
      return {
        label: 'Vocal Cut มีข้อผิดพลาด',
        detail: state.lastError ?? 'คลิก Extension เพื่อเชื่อมต่อใหม่',
        className: 'border-rose-400/45 bg-rose-950/90 text-rose-50',
        icon: AlertTriangle,
      };
    case 'not_installed':
      return {
        label: 'Vocal Cut Extension ไม่พร้อม',
        detail: 'ติดตั้ง Extension เพื่อใช้งาน',
        className: 'border-white/15 bg-zinc-950/85 text-zinc-300',
        icon: MicOff,
      };
    case 'checking':
      return {
        label: 'กำลังตรวจ Vocal Cut…',
        detail: 'ตรวจหา Extension ในเครื่อง',
        className: 'border-white/10 bg-zinc-950/75 text-zinc-400',
        icon: Radio,
      };
    default:
      return {
        label: 'Vocal Cut ยังไม่เปิดระบบเสียง',
        detail: 'คลิกไอคอน Extension หนึ่งครั้ง',
        className: 'border-white/15 bg-zinc-950/85 text-zinc-300',
        icon: MicOff,
      };
  }
}

function formatSideLevel(sideRatio: number | null): string | null {
  if (sideRatio === null || !Number.isFinite(sideRatio)) return null;
  if (sideRatio <= 1e-6) return '< -60 dB';
  return `${(10 * Math.log10(sideRatio)).toFixed(1)} dB`;
}

function formatCenterReduction(centerGain: number | null): string | null {
  if (centerGain === null || !Number.isFinite(centerGain) || centerGain <= 0) return null;
  return `${Math.max(0, -20 * Math.log10(centerGain)).toFixed(1)} dB`;
}

function formatSignedDecibels(value: number | null): string | null {
  if (value === null || !Number.isFinite(value)) return null;
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)} dB`;
}

function getNormalizeDetail(state: VocalCutExtensionState): string {
  if (!state.normalizeEnabled || state.normalizeStatus === 'off') return 'ปรับความดังแต่ละเพลงอัตโนมัติ';
  if (state.normalizeStatus === 'warming') return 'กำลังวัดระดับเสียงเพลง…';
  if (state.normalizeStatus === 'silence_hold') return 'พักการปรับระหว่างช่วงเงียบ';
  const loudness = state.measuredLoudnessDb === null
    ? null
    : `${state.measuredLoudnessDb.toFixed(1)} LUFS-like`;
  const gain = formatSignedDecibels(state.normalizationGainDb);
  const metrics = [loudness, gain].filter(Boolean).join(' · ');
  if (state.normalizeStatus === 'limited') {
    return metrics ? `ถึงขีดจำกัด · ${metrics}` : 'ถึงขีดจำกัดการชดเชยเสียง';
  }
  return metrics || 'กำลังปรับระดับเสียง';
}

export function PlayerVocalCutStatus({
  state,
  notice,
  hasRequestedFeedback,
  hasSong,
  onToggle,
  onSubmitResult,
  onPresetChange,
  showNormalizeFeedback,
  normalizeFeedbackFading,
}: PlayerVocalCutStatusProps) {
  const presentation = getStatusPresentation(state);
  const StatusIcon = presentation.icon;
  const canToggle = hasSong && (
    state.captureStatus === 'capturing_original'
    || state.captureStatus === 'capturing_vocal_cut'
    || state.captureStatus === 'unsupported_mono'
  );
  const previousResult = state.preference?.lastResult;
  const sideLevel = formatSideLevel(state.sideRatio);
  const centerReduction = formatCenterReduction(state.adaptiveCenterGain);
  const centerConfidence = state.adaptiveCenterConfidence === null
    ? null
    : `${Math.round(state.adaptiveCenterConfidence * 100)}%`;
  const showStatusControl = state.enabled || state.captureStatus === 'error';
  const showNotice = Boolean(notice && (hasRequestedFeedback || showNormalizeFeedback));

  if (!showNormalizeFeedback && (!hasRequestedFeedback || (!showStatusControl && !showNotice))) return null;

  return (
    <aside className="pointer-events-none absolute left-4 top-4 z-30 flex max-w-[min(24rem,calc(100%-2rem))] flex-col items-start gap-2">
      {showNormalizeFeedback && (
        <div
          role="status"
          aria-live="polite"
          className={`flex max-w-full items-center gap-2.5 rounded-xl border px-3 py-2 text-left shadow-xl backdrop-blur-md transition-opacity duration-500 motion-reduce:transition-none ${
            normalizeFeedbackFading ? 'opacity-0' : 'opacity-100'
          } ${
            state.normalizeEnabled
              ? 'border-emerald-400/50 bg-emerald-950/90 text-emerald-50'
              : 'border-white/15 bg-zinc-950/90 text-zinc-300'
          }`}
        >
          <Gauge className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0">
            <span className="block truncate text-xs font-bold sm:text-sm">
              AUTO LEVEL: {state.normalizeEnabled ? 'ON' : 'OFF'}
            </span>
            <span aria-live="off" className="block truncate text-[10px] opacity-70 sm:text-xs">
              {getNormalizeDetail(state)}
            </span>
          </span>
        </div>
      )}

      {hasRequestedFeedback && showStatusControl && (
        <button
          type="button"
          onClick={onToggle}
          disabled={!canToggle}
          className={`pointer-events-auto flex max-w-full items-center gap-2.5 rounded-xl border px-3 py-2 text-left shadow-xl backdrop-blur-md transition ${presentation.className} disabled:cursor-default`}
          aria-pressed={state.enabled}
          title={canToggle ? 'กด * เพื่อเปิดหรือปิด Vocal Cut' : presentation.detail}
        >
          <StatusIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0">
            <span className="block truncate text-xs font-bold sm:text-sm">{presentation.label}</span>
            <span className="block truncate text-[10px] opacity-70 sm:text-xs">{presentation.detail}</span>
          </span>
        </button>
      )}

      {showNotice && (
        <p className="max-w-full rounded-lg border border-amber-400/25 bg-amber-950/90 px-3 py-1.5 text-[11px] text-amber-100 shadow-lg" role="status">
          {notice}
        </p>
      )}

      {state.monoLike && hasSong && !notice && (
        <p className="max-w-full rounded-lg border border-amber-400/25 bg-amber-950/90 px-3 py-1.5 text-[11px] text-amber-100 shadow-lg" role="status">
          {state.inputChannelCount === 1
            ? 'ตรวจพบเสียง 1 channel — Vocal Cut ยังเปิดได้ แต่ผลอาจจำกัด'
            : 'Stereo side ต่ำ — Vocal Cut ยังเปิดได้ แต่ผลอาจกระทบเครื่องดนตรี'}
        </p>
      )}

      {state.enabled && hasSong && (
        <div className="pointer-events-auto flex max-w-full flex-col gap-2 rounded-xl border border-white/10 bg-zinc-950/90 p-2 text-[10px] text-zinc-300 shadow-xl backdrop-blur-md">
          {(sideLevel || centerReduction || centerConfidence) && (
            <p className="px-1 text-[9px] text-zinc-400">
              DSP: Center {centerConfidence ?? '—'} · ลด {centerReduction ?? '—'} · Side {sideLevel ?? '—'}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="เลือกระดับ Vocal Cut">
            <span className="px-1">ระดับ:</span>
            {(Object.keys(PRESET_LABELS) as VocalCutPreset[]).map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => onPresetChange(preset)}
                className={`rounded-md border px-2 py-1 transition ${
                  state.preset === preset
                    ? 'border-cyan-300/60 bg-cyan-500/25 text-cyan-50'
                    : 'border-white/10 bg-white/5 hover:bg-white/10'
                }`}
              >
                {PRESET_LABELS[preset]}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="ประเมินผล Vocal Cut">
            <span className="px-1">ผลลัพธ์:</span>
            {(Object.keys(RESULT_LABELS) as VocalCutResult[]).map((result) => (
              <button
                key={result}
                type="button"
                onClick={() => onSubmitResult(result)}
                className={`rounded-md border px-2 py-1 transition ${
                  previousResult === result
                    ? 'border-fuchsia-300/60 bg-fuchsia-500/25 text-fuchsia-50'
                    : 'border-white/10 bg-white/5 hover:bg-white/10'
                }`}
              >
                {RESULT_LABELS[result]}
              </button>
            ))}
          </div>
        </div>
      )}

      {!state.enabled && previousResult && hasSong && (
        <p className="flex items-center gap-1 rounded-lg border border-white/10 bg-zinc-950/85 px-2.5 py-1.5 text-[10px] text-zinc-300 shadow-lg">
          <Star className="h-3 w-3 text-amber-300" aria-hidden="true" />
          เพลงนี้เคยประเมินว่า “{RESULT_LABELS[previousResult]}” · กด * เพื่อเปิด
        </p>
      )}
    </aside>
  );
}
