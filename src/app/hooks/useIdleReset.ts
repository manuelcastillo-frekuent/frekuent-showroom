import { useEffect } from 'react';

/** Calls `onIdle` once nobody has touched the screen for `ms`, unless `paused`. */
export function useIdleReset(ms: number, onIdle: () => void, paused = false) {
  useEffect(() => {
    if (paused) return;
    let timer = setTimeout(onIdle, ms);
    const restart = () => {
      clearTimeout(timer);
      timer = setTimeout(onIdle, ms);
    };
    window.addEventListener('pointerdown', restart);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('pointerdown', restart);
    };
  }, [ms, onIdle, paused]);
}
