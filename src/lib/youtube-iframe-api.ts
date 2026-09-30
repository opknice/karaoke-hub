let youtubeApiPromise: Promise<typeof YT> | null = null;

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

    window.onYouTubeIframeAPIReady = () => {
      previousReadyHandler?.();

      if (window.YT?.Player) {
        resolve(window.YT);
      } else {
        reject(new Error('The YouTube IFrame API loaded without the Player constructor.'));
      }
    };

    const existingScript = document.querySelector<HTMLScriptElement>(
      'script[src="https://www.youtube.com/iframe_api"]'
    );

    if (existingScript) {
      existingScript.addEventListener(
        'error',
        () => reject(new Error('Unable to load the YouTube IFrame API.')),
        { once: true }
      );
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.async = true;
    script.addEventListener(
      'error',
      () => reject(new Error('Unable to load the YouTube IFrame API.')),
      { once: true }
    );
    document.head.appendChild(script);
  });

  return youtubeApiPromise;
}
