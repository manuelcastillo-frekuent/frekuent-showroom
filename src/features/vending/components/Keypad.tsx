import { box, u } from '@/shared/stage/scene';
import { KEYS, keyLabel, type Key } from '../domain/keypad';
import { C } from './palette';

export function Keypad({ onPress }: { onPress: (key: Key) => void }) {
  return (
    <div
      style={{
        ...box(319, 238, 80, 126),
        gap: u(4),
        display: 'grid',
        gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
        gridTemplateRows: 'repeat(4, minmax(0, 1fr))',
      }}
    >
      {KEYS.map((k) => (
        <button
          key={k}
          onClick={() => onPress(k)}
          aria-label={keyLabel(k)}
          className="key"
          style={{
            color: '#fff',
            background: C.key,
            borderRadius: u(5),
            fontSize: u(12),
            boxShadow: `inset 0 -${u(2)}px 0 rgba(0,0,0,.25)`,
          }}
        >
          {k}
        </button>
      ))}
    </div>
  );
}
