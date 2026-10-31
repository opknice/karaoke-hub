const DEFAULT_PLAYER_URL = 'https://karaoke-hub-nu.vercel.app/player';

function resolvePlayerUrl(value = DEFAULT_PLAYER_URL) {
  const url = new URL(value);
  if (url.username || url.password || !['/player', '/player/'].includes(url.pathname)) throw new Error('Invalid Player URL');
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && url.protocol === 'http:';
  if (!local && url.origin !== new URL(DEFAULT_PLAYER_URL).origin) throw new Error('Untrusted Player origin');
  return url.href;
}
function isPlayerUrl(value, configuredUrl) {
  try {
    const url = new URL(value);
    const configured = new URL(resolvePlayerUrl(configuredUrl));
    return !url.username && !url.password && url.origin === configured.origin && ['/player', '/player/'].includes(url.pathname);
  } catch { return false; }
}
function validateCommand(type, payload = {}) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
  switch (type) {
    case 'PLAYER_HELLO': case 'REQUEST_STATUS': case 'START_AUDIO': case 'STOP_AUDIO':
    case 'TEMPO_UP': case 'TEMPO_DOWN': case 'RESET_AUDIO': return true;
    case 'SET_PITCH': return Number.isInteger(payload.semitones) && payload.semitones >= -6 && payload.semitones <= 6;
    case 'SET_PLAYBACK_RATE': return Number.isFinite(payload.playbackRate) && payload.playbackRate >= 0.25 && payload.playbackRate <= 2;
    case 'SET_PLAYER_VOLUME': return Number.isFinite(payload.volume) && payload.volume >= 0 && payload.volume <= 100 && typeof payload.muted === 'boolean';
    case 'SET_SEARCH_VERSION': return payload.version === 'karaoke' || payload.version === 'mv';
    case 'SET_VOCAL_REMOVER': return typeof payload.enabled === 'boolean';
    case 'SET_VOCAL_LEVEL': return Object.keys(payload).length===1&&Number.isInteger(payload.level)&&payload.level>=0&&payload.level<=100;
    case 'FOCUS_PLAYER_SEARCH': return Object.keys(payload).length===0;
    case 'SET_VOCAL_MODEL': return Object.keys(payload).length===1&&(payload.modelId==='fast'||payload.modelId==='hq5');
    case 'PREPARE_PLAYER_TRACK': return Object.keys(payload).length===3&&typeof payload.youtubeVideoId==='string'&&/^[\w-]{11}$/.test(payload.youtubeVideoId)
      &&typeof payload.queueItemId==='string'&&payload.queueItemId.length>0&&payload.queueItemId.length<=128&&(payload.versionType==='mv'||payload.versionType==='karaoke');
    case 'CANCEL_PLAYER_PREPARATION': return Object.keys(payload).length===1&&typeof payload.preparationId==='string'&&payload.preparationId.length>0&&payload.preparationId.length<=128;
    case 'VOCAL_PLAYBACK_STATE': return typeof payload.playing==='boolean'&&typeof payload.youtubeVideoId==='string'&&/^[\w-]{11}$/.test(payload.youtubeVideoId)
      &&typeof payload.queueItemId==='string'&&payload.queueItemId.length>0&&payload.queueItemId.length<=128&&(payload.mediaReady===undefined||typeof payload.mediaReady==='boolean');
    case 'TRACK_CHANGED': return (payload.youtubeVideoId === null || (typeof payload.youtubeVideoId === 'string' && /^[\w-]{11}$/.test(payload.youtubeVideoId)))
      && (payload.versionType === undefined || payload.versionType === 'karaoke' || payload.versionType === 'mv')
      && (payload.queueItemId === undefined || payload.queueItemId === null || (typeof payload.queueItemId === 'string' && payload.queueItemId.length > 0 && payload.queueItemId.length <= 128));
    default: return false;
  }
}
module.exports = { DEFAULT_PLAYER_URL, resolvePlayerUrl, isPlayerUrl, validateCommand };
