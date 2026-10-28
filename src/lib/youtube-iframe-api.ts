let youtubeApiPromise: Promise<typeof YT> | null = null;
const YOUTUBE_API_TIMEOUT_MS = 15_000;

declare global {
  interface Window {
    YT?: typeof YT;
    onYouTubeIframeAPIReady?: () => void;
  }
}

/** Loads the YouTube IFrame API once, even when React mounts twice in development. */
export function loadYouTubeIframeApi(): Promise<typeof YT> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('The YouTube IFrame API is only available in the browser.'));
  }

  if (window.YT?.Player) {
    return Promise.resolve(window.YT);
  }

  if (youtubeApiPromise) {
    return youtubeApiPromise;
  }

  youtubeApiPromise = new Promise<typeof YT>((resolve, reject) => {
    const previousReadyHandler = window.onYouTubeIframeAPIReady;
    const existingScript = document.querySelector<HTMLScriptElement>(
      'script[src="https://www.youtube.com/iframe_api"]'
    );
    const script = existingScript ?? document.createElement('script');
    const cleanup = () => {
      clearTimeout(timer);
      script.removeEventListener('error', onError);
      if (window.onYouTubeIframeAPIReady === onReady) {
        window.onYouTubeIframeAPIReady = previousReadyHandler;
      }
    };
    const fail = (message: string) => {
      cleanup();
      script.remove();
      reject(new Error(message));
    };
    const onError = () => fail('Unable to load the YouTube IFrame API.');
    const onReady = () => {
      if (!window.YT?.Player) {
        fail('The YouTube IFrame API loaded without the Player constructor.');
        return;
      }
      cleanup();
      resolve(window.YT);
      try { previousReadyHandler?.(); }
      catch (error) { console.warn('Previous YouTube readiness handler failed:', error); }
    };
    const timer = setTimeout(() => fail('YouTube IFrame API readiness timed out. Please retry.'), YOUTUBE_API_TIMEOUT_MS);
    window.onYouTubeIframeAPIReady = onReady;
    script.addEventListener('error', onError, { once: true });
    if (!existingScript) {
      script.src = 'https://www.youtube.com/iframe_api';
      script.async = true;
      document.head.appendChild(script);
    }
  }).catch((error: unknown) => {
    youtubeApiPromise = null;
    throw error;
  });

  return youtubeApiPromise;
}
