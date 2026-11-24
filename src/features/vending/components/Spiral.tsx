import { useId } from 'react';
import { u } from '@/shared/stage/scene';
import { SPIRAL_TURN_MS, SPIRAL_TURNS } from './dispenseTiming';
import { C } from './palette';

/** One zigzag period in viewBox units; shifting by it reads as a full turn. */
const PERIOD = 12;

/** Spiral seen from the front. While `turning`, it screws forward as if pushing the product out. */
export function Spiral({ turning = false }: { turning?: boolean }) {
  const clipId = useId();
  return (
    <svg width={u(70)} height={u(8)} viewBox="0 0 70 8" aria-hidden="true">
      {turning ? (
        <>
          <clipPath id={clipId}>
            <rect x="2" y="0" width="66" height="8" />
          </clipPath>
          <g clipPath={`url(#${clipId})`}>
            <path
              className="spiral-turn"
              style={{
                animationDuration: `${SPIRAL_TURN_MS}ms`,
                animationIterationCount: SPIRAL_TURNS,
              }}
              d={zigzag(2 - PERIOD, 68 + PERIOD)}
              fill="none"
              stroke={C.spiral}
              strokeWidth="1.5"
            />
          </g>
        </>
      ) : (
        <path
          d="M2 4 L8 1 L14 7 L20 1 L26 7 L32 1 L38 7 L44 1 L50 7 L56 1 L62 7 L68 4"
          fill="none"
          stroke={C.spiral}
          strokeWidth="1.5"
        />
      )}
    </svg>
  );
}

/** Same zigzag phase as the static path (bottom at x ≡ 2, top at x ≡ 8, mod 12). */
function zigzag(from: number, to: number) {
  const points: string[] = [];
  for (let x = from; x <= to; x += PERIOD / 2) {
    points.push(`${x} ${(x - 2) % PERIOD === 0 ? 7 : 1}`);
  }
  return `M${points.join(' L')}`;
}
