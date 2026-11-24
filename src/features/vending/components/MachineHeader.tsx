import { box, u } from '@/shared/stage/scene';
import { C } from './palette';

export function MachineHeader() {
  return (
    <div
      style={{ ...box(17, 6, 376, 18), fontSize: u(11), color: C.label }}
      className="row between"
    >
      <span>Snacks and drinks</span>
      <span className="row" style={{ gap: u(5) }}>
        <span style={{ width: u(6), height: u(6), borderRadius: '50%', background: C.online }} />
        Online
      </span>
    </div>
  );
}
