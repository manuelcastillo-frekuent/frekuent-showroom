import { box, u } from '@/shared/stage/scene';
import type { Product } from '../domain/products';
import { C } from './palette';
import { ProductShape } from './ProductShape';

interface PickupTrayProps {
  /** Product on its way to the tray or already in it; null when there is nothing to deliver. */
  item: Product | null;
  delivered: boolean;
  onTake: () => void;
}

/**
 * Pickup tray. While the item is still falling it keeps an invisible copy where it
 * will rest, which `DispenseFlight` aims at; on delivery that copy is shown.
 */
export function PickupTray({ item, delivered, onTake }: PickupTrayProps) {
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
      {/* Opening under the flap: the only part of the tray a falling product shows through. */}
      <div
        data-anchor="tray-window"
        className="abs"
        style={{ left: 0, right: 0, top: u(24), bottom: 0, pointerEvents: 'none' }}
      />
      {item && (
        <>
          <div
            className="abs row"
            style={{ left: 0, right: 0, bottom: u(12), justifyContent: 'center' }}
          >
            <ProductShape product={item} hidden={!delivered} anchor="tray" />
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
