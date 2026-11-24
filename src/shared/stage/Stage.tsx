import { useLayoutEffect, useState, type ReactNode } from 'react';

/** Logical canvas: the 4K vertical panel. Everything is laid out in these pixels. */
export const STAGE_WIDTH = 2160;
export const STAGE_HEIGHT = 3840;

function fitScale() {
  return Math.min(window.innerWidth / STAGE_WIDTH, window.innerHeight / STAGE_HEIGHT);
}

/**
 * Scales the fixed 2160×3840 canvas to whatever viewport it runs in: the 65″
 * or 86″ totem, or a laptop window while developing. Pau's artwork is drawn
 * at this size, so layout never depends on the physical screen.
 */
export function Stage({ children }: { children: ReactNode }) {
  const [scale, setScale] = useState(fitScale);

  useLayoutEffect(() => {
    const onResize = () => setScale(fitScale());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return (
    <div className="row center" style={{ width: '100%', height: '100%', overflow: 'hidden' }}>
      <div
        style={{
          position: 'relative',
          overflow: 'hidden',
          width: STAGE_WIDTH * scale,
          height: STAGE_HEIGHT * scale,
        }}
      >
        <div
          style={{
            width: STAGE_WIDTH,
            height: STAGE_HEIGHT,
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
            top: 0,
            left: 0,
            background: 'var(--nude-light)',
            color: 'var(--ink)',
          }}
          className="abs"
        >
          {children}
        </div>
      </div>
    </div>
  );
}
