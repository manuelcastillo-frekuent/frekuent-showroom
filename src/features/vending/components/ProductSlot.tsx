import { formatCents } from '@/shared/utils/format';
import { u } from '@/shared/stage/scene';
import type { Product } from '../domain/products';
import { JAM_MS } from './dispenseTiming';
import { C } from './palette';
import { ProductShape } from './ProductShape';
import { Spiral } from './Spiral';

interface ProductSlotProps {
  product: Product;
  selected: boolean;
  /** The product has left the slot: the flight over the cabinet draws it now. */
  dropped: boolean;
  /** The spiral is screwing the product out. */
  turning: boolean;
  /** Forced failed delivery: the product sticks at the edge of the slot and never falls. */
  jammed: boolean;
  onJamEnd: () => void;
}

/** One spiral behind the glass: product, spiral, code tag and price. */
export function ProductSlot({
  product,
  selected,
  dropped,
  turning,
  jammed,
  onJamEnd,
}: ProductSlotProps) {
  const price = product.soldOut ? 'Sold out' : formatCents(product.priceCents);
  return (
    <div
      aria-label={`${product.code} ${product.name}, ${product.soldOut ? 'sold out' : price}`}
      className="col"
      style={{
        minHeight: 0,
        alignItems: 'center',
        justifyContent: 'flex-end',
        gap: u(3),
        padding: `${u(4)}px 0`,
        borderRadius: u(8),
        opacity: product.soldOut ? 0.4 : 1,
        background: selected ? 'rgba(186,172,242,.35)' : 'rgba(0,0,0,.12)',
        border: `${u(2)}px solid ${selected ? C.lilac : 'transparent'}`,
      }}
    >
      {jammed ? (
        <span
          className="jam"
          style={{ display: 'block', animationDuration: `${JAM_MS}ms` }}
          onAnimationEnd={onJamEnd}
        >
          <ProductShape product={product} />
        </span>
      ) : (
        <ProductShape product={product} hidden={dropped} anchor={`slot-${product.code}`} />
      )}
      <Spiral turning={turning} />
      <span
        className="row between"
        style={{ width: '100%', padding: `0 ${u(3)}px`, fontSize: u(10), color: '#fff' }}
      >
        <span style={{ background: C.base, borderRadius: u(3), padding: `${u(1)}px ${u(3)}px` }}>
          {product.code}
        </span>
        <span>{price}</span>
      </span>
    </div>
  );
}
