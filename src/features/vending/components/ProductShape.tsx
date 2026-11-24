import type { CSSProperties } from 'react';
import { u } from '@/shared/stage/scene';
import type { Product } from '../domain/products';

const SIZE: Record<Product['kind'], [number, number]> = {
  bottle: [24, 76],
  can: [32, 56],
  bag: [62, 72],
  bar: [66, 20],
  box: [58, 44],
};

function shapeStyle(product: Product): CSSProperties {
  const [w, h] = SIZE[product.kind].map(u) as [number, number];
  const radius =
    product.kind === 'bottle'
      ? `${u(9)}px ${u(9)}px ${u(4)}px ${u(4)}px`
      : `${u(product.kind === 'can' ? 6 : 5)}px`;
  return {
    display: 'block',
    width: w,
    height: h,
    borderRadius: radius,
    background: product.color,
    boxShadow: `inset 0 -${h * 0.3}px 0 rgba(255,255,255,.22), inset 0 -${h * 0.42}px 0 rgba(0,0,0,.12), 0 ${u(2)}px ${u(4)}px rgba(0,0,0,.25)`,
  };
}

/** Flat drawing of a product (bottle, can, bag…) in its own colour. */
export function ProductShape({ product, hidden = false }: { product: Product; hidden?: boolean }) {
  return <span style={{ ...shapeStyle(product), visibility: hidden ? 'hidden' : 'visible' }} />;
}
