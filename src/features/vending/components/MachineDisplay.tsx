import { box, u } from '@/shared/stage/scene';
import { C } from './palette';

interface MachineDisplayProps {
  code: string;
  line1: string;
  line2: string;
}

/** Small screen above the keypad; announced to screen readers as it changes. */
export function MachineDisplay({ code, line1, line2 }: MachineDisplayProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        ...box(319, 160, 80, 68),
        background: C.screen,
        borderRadius: u(6),
        padding: `${u(6)}px ${u(8)}px`,
        gap: u(2),
        justifyContent: 'center',
        color: '#fff',
      }}
      className="col"
    >
      <span style={{ fontSize: u(15), letterSpacing: '.06em', fontWeight: 500 }}>{code}</span>
      <span style={{ fontSize: u(11) }}>{line1}</span>
      <span style={{ fontSize: u(9.5), color: C.lilac }}>{line2}</span>
    </div>
  );
}
