import { u } from '@/shared/stage/scene';
import { C } from './palette';

export function Spiral() {
  return (
    <svg width={u(70)} height={u(8)} viewBox="0 0 70 8" aria-hidden="true">
      <path
        d="M2 4 L8 1 L14 7 L20 1 L26 7 L32 1 L38 7 L44 1 L50 7 L56 1 L62 7 L68 4"
        fill="none"
        stroke={C.spiral}
        strokeWidth="1.5"
      />
    </svg>
  );
}
