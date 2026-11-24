import { box, u } from '@/shared/stage/scene';
import { C } from './palette';

export function Vents() {
  return (
    <div style={{ ...box(335, 640, 48, 30), gap: u(5) }} className="col">
      {[0, 1, 2, 3].map((i) => (
        <span key={i} style={{ height: u(3), borderRadius: u(2), background: C.glass }} />
      ))}
    </div>
  );
}
