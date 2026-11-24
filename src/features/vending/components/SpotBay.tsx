import { box, u } from '@/shared/stage/scene';
import { C } from './palette';

interface SpotBayProps {
  waiting: boolean;
  /** Demo mode: tapping the bay stands in for the visitor's card. */
  canSimulateTap: boolean;
  onTap: () => void;
}

/** Spot Pro bay where the visitor taps, with its caption underneath. */
export function SpotBay({ waiting, canSimulateTap, onTap }: SpotBayProps) {
  const demoTap = canSimulateTap && waiting;
  return (
    <>
      <button
        onClick={onTap}
        aria-label={demoTap ? 'Simulate card tap' : 'Spot Pro'}
        style={{ ...box(319, 400, 80, 124), background: C.bay, borderRadius: u(6) }}
        className="row center"
      >
        <span
          className={waiting ? 'pulse' : undefined}
          style={{
            width: u(46),
            height: u(92),
            borderRadius: u(8),
            border: `${u(2)}px dashed ${waiting ? '#ffffff' : C.lilac}`,
            boxShadow: waiting ? `0 0 0 ${u(6)}px rgba(103,63,255,.45)` : 'none',
          }}
        />
      </button>
      <span
        style={{ ...box(319, 528, 80, 14), fontSize: u(10), color: C.label, textAlign: 'center' }}
      >
        {demoTap ? 'Tap here (demo)' : 'Spot Pro'}
      </span>
    </>
  );
}
