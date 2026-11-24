export const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫'] as const;

export type Key = (typeof KEYS)[number];

/** Product codes are two digits: row then column. */
export const CODE_LENGTH = 2;

export const keyLabel = (key: Key) =>
  key === '⌫' ? 'Delete digit' : key === 'C' ? 'Cancel' : `Key ${key}`;
