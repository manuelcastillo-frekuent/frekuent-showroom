export interface Product {
  /** Keypad code: row (1–6) then column (1–3), as on a real machine. */
  code: string;
  name: string;
  priceCents: number;
  kind: 'bottle' | 'can' | 'bag' | 'bar' | 'box';
  color: string;
  soldOut?: boolean;
}

/** Catalogue from Germán's prototype; prices are rendered by us, not baked into the art. */
export const PRODUCTS: Product[] = [
  { code: '11', name: 'Still water', priceCents: 120, kind: 'bottle', color: '#4b9fd8' },
  { code: '12', name: 'Sparkling water', priceCents: 130, kind: 'bottle', color: '#8fc7e8' },
  { code: '13', name: 'Orange juice', priceCents: 180, kind: 'bottle', color: '#ffb547' },
  { code: '21', name: 'Cola', priceCents: 160, kind: 'can', color: '#b3262f' },
  { code: '22', name: 'Lemon soda', priceCents: 160, kind: 'can', color: '#ffd74a' },
  { code: '23', name: 'Iced tea', priceCents: 170, kind: 'can', color: '#e8833a' },
  { code: '31', name: 'Sports drink', priceCents: 200, kind: 'bottle', color: '#06cc41' },
  { code: '32', name: 'Iced coffee', priceCents: 210, kind: 'can', color: '#7a4a2a' },
  {
    code: '33',
    name: 'Energy drink',
    priceCents: 220,
    kind: 'can',
    color: '#3e4c51',
    soldOut: true,
  },
  { code: '41', name: 'Crisps', priceCents: 150, kind: 'bag', color: '#ffd74a' },
  { code: '42', name: 'Nachos', priceCents: 170, kind: 'bag', color: '#e8833a' },
  { code: '43', name: 'Nuts', priceCents: 190, kind: 'bag', color: '#b0977e' },
  { code: '51', name: 'Chocolate bar', priceCents: 130, kind: 'bar', color: '#7a4a2a' },
  { code: '52', name: 'Cereal bar', priceCents: 150, kind: 'bar', color: '#9b86ec' },
  { code: '53', name: 'Cookies', priceCents: 140, kind: 'bar', color: '#b0977e' },
  { code: '61', name: 'Ham and cheese sandwich', priceCents: 320, kind: 'box', color: '#f3f1fd' },
  { code: '62', name: 'Salad', priceCents: 390, kind: 'box', color: '#bfe8c4' },
  { code: '63', name: 'Fruit', priceCents: 100, kind: 'box', color: '#ffb547' },
];

export const findProduct = (code: string) => PRODUCTS.find((p) => p.code === code);
