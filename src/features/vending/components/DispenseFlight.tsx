import { useEffect, useLayoutEffect, useRef } from 'react';
import { u } from '@/shared/stage/scene';
import type { Product } from '../domain/products';
import { DISPENSE_MS, FALL_MS, LAND_MS, SPIRAL_MS, ZOOM_MS } from './dispenseTiming';
import { ProductShape } from './ProductShape';

interface DispenseFlightProps {
  product: Product;
  /** Fired once the product rests in the tray. */
  onLand: () => void;
}

/**
 * Where the inside of the machine can be seen. The falling product is drawn once
 * per window, cropped to it, so between them it passes behind the cabinet panel.
 */
const WINDOWS = ['glass', 'tray-window'] as const;

const at = (ms: number) => ms / DISPENSE_MS;
const GRAVITY = 'cubic-bezier(.5, 0, 1, .5)';
const tf = (x: number, y: number, scale: number, deg: number) =>
  `translate(${x}px, ${y}px) scale(${scale}) rotate(${deg}deg)`;

function flightKeyframes(dx: number, dy: number): Keyframe[] {
  return [
    { offset: 0, transform: tf(0, 0, 1, 0) },
    // The spiral pushes the product towards the front of its slot.
    { offset: at(SPIRAL_MS), transform: tf(0, 0, 1.08, 0), easing: 'ease-out' },
    // Out of the slot towards the glass, teetering on the edge.
    { offset: at(SPIRAL_MS + ZOOM_MS * 0.6), transform: tf(0, -u(4), 1.4, -4) },
    { offset: at(SPIRAL_MS + ZOOM_MS), transform: tf(0, -u(2), 1.4, 3), easing: GRAVITY },
    // Free fall to the tray, shrinking back as it drops to the back of the machine.
    { offset: at(SPIRAL_MS + ZOOM_MS + FALL_MS), transform: tf(dx, dy, 1, 10), easing: 'ease-out' },
    {
      offset: at(SPIRAL_MS + ZOOM_MS + FALL_MS + LAND_MS * 0.5),
      transform: tf(dx, dy - u(10), 1, -3),
      easing: 'ease-in',
    },
    { offset: 1, transform: tf(dx, dy, 1, 0) },
  ];
}

/**
 * The product leaving its spiral: pushed forward, coming out towards the glass,
 * then falling inside the machine into the pickup tray. Drawn over the cabinet
 * because the glass clips its slots. Must be a direct child of the cabinet body,
 * which it measures against.
 */
export function DispenseFlight({ product, onLand }: DispenseFlightProps) {
  const ref = useRef<HTMLDivElement>(null);
  // The animation outlives renders; it must call the latest handler, not restart on a new one.
  const onLandRef = useRef(onLand);
  useEffect(() => {
    onLandRef.current = onLand;
  }, [onLand]);

  useLayoutEffect(() => {
    const root = ref.current;
    const body = root?.parentElement;
    const find = (anchor: string) => body?.querySelector(`[data-anchor="${anchor}"]`);
    const from = find(`slot-${product.code}`);
    const to = find('tray');
    const windows = WINDOWS.map(find);
    if (!root || !body || !from || !to || windows.some((w) => !w)) {
      onLandRef.current();
      return;
    }

    // Rects come back in screen pixels, after the Stage scale; bring them to cabinet pixels.
    const bodyRect = body.getBoundingClientRect();
    const scale = bodyRect.width / body.offsetWidth;
    const local = (el: Element) => {
      const r = el.getBoundingClientRect();
      return {
        left: (r.left - bodyRect.left) / scale,
        top: (r.top - bodyRect.top) / scale,
        width: r.width / scale,
        height: r.height / scale,
      };
    };
    const start = local(from);
    const end = local(to);
    const keyframes = flightKeyframes(end.left - start.left, end.top - start.top);

    const animations = windows.map((win, i) => {
      const box = local(win!);
      const frame = root.children[i] as HTMLElement;
      Object.assign(frame.style, {
        left: `${box.left}px`,
        top: `${box.top}px`,
        width: `${box.width}px`,
        height: `${box.height}px`,
        visibility: 'visible',
      });
      const flyer = frame.firstElementChild as HTMLElement;
      flyer.style.left = `${start.left - box.left}px`;
      flyer.style.top = `${start.top - box.top}px`;
      return flyer.animate(keyframes, { duration: DISPENSE_MS, fill: 'forwards' });
    });
    // Both copies share the clock; one finishing means the product has landed.
    animations[0]!.onfinish = () => onLandRef.current();
    return () => animations.forEach((a) => a.cancel());
  }, [product.code]);

  return (
    <div ref={ref} aria-hidden="true" className="fill" style={{ pointerEvents: 'none' }}>
      {WINDOWS.map((name) => (
        <div key={name} className="abs" style={{ overflow: 'hidden', visibility: 'hidden' }}>
          <div
            className="abs"
            style={{
              transformOrigin: 'center',
              willChange: 'transform',
              filter: `drop-shadow(0 ${u(4)}px ${u(6)}px rgba(0,0,0,.35))`,
            }}
          >
            <ProductShape product={product} />
          </div>
        </div>
      ))}
    </div>
  );
}
