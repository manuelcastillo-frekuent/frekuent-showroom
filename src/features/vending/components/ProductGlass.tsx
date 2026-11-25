import { box, u } from '@/shared/stage/scene';
import type { Product } from '../domain/products';
import { C } from './palette';
import { ProductSlot } from './ProductSlot';

interface ProductGlassProps {
  products: Product[];
  selectedCode: string | null;
  dropping: boolean;
  dispensing: boolean;
}

/** Glass front with the 6 × 3 grid of spirals. */
export function ProductGlass({ products, selectedCode, dropping, dispensing }: ProductGlassProps) {
  return (
    <div
      data-anchor="glass"
      style={{
        ...box(17, 28, 285, 742),
        background: C.glass,
        borderRadius: u(8),
        padding: u(8),
        gap: u(6),
        display: 'grid',
        gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
        gridTemplateRows: 'repeat(6, minmax(0, 1fr))',
        overflow: 'hidden',
      }}
    >
      {products.map((p) => {
        const selected = p.code === selectedCode;
        return (
          <ProductSlot
            key={p.code}
            product={p}
            selected={selected}
            dropped={selected && dropping}
            turning={selected && dispensing}
          />
        );
      })}
      {/* Glare */}
      <div
        className="fill"
        style={{
          pointerEvents: 'none',
          background:
            'linear-gradient(115deg, rgba(255,255,255,0) 30%, rgba(255,255,255,.07) 38%, rgba(255,255,255,0) 46%)',
        }}
      />
    </div>
  );
}
