import type { CSSProperties } from 'react';
import { box, u } from '@/shared/stage/scene';
import type { Product } from '../domain/products';
import { C } from './palette';
import { ProductShape } from './ProductShape';

interface PickupTrayProps {
  /** Product falling into the tray; null when there is nothing to deliver. */
  item: Product | null;
  delivered: boolean;
  onDropEnd: () => void;
  onTake: () => void;
}

export function PickupTray({ item, delivered, onDropEnd, onTake }: PickupTrayProps) {
  return (
    <div
      style={{
        ...box(17, 781, 376, 137),
        background: C.tray,
        borderRadius: u(8),
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          height: u(22),
          background: C.trayHead,
          borderBottom: `${u(2)}px solid ${C.key}`,
          fontSize: u(10),
          color: C.label,
          paddingLeft: u(10),
        }}
        className="row"
      >
        Pickup
      </div>
      {item && (
        <>
          <div
            key={item.code}
            className="abs row drop"
            style={
              {
                left: 0,
                right: 0,
                bottom: u(12),
                justifyContent: 'center',
                '--drop-from': `${-u(120)}px`,
              } as CSSProperties
            }
            onAnimationEnd={onDropEnd}
          >
            <ProductShape product={item} />
          </div>
          {delivered && (
            <button
              onClick={onTake}
              className="abs"
              style={{
                borderRadius: 9999,
                background: '#fff',
                color: C.base,
                right: u(10),
                top: u(30),
                height: u(30),
                padding: `0 ${u(12)}px`,
                fontSize: u(11),
              }}
            >
              Take your item
            </button>
          )}
        </>
      )}
    </div>
  );
}
