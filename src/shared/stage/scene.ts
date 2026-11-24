import type { CSSProperties } from 'react';
import { STAGE_HEIGHT, STAGE_WIDTH } from './Stage';

/**
 * Germán's prototype draws each scene on a 546 px-wide board. We keep its
 * measurements and multiply by SCENE_SCALE, so the machine stays faithful to
 * the approved design; at this scale it fits the stage height.
 */
export const SCENE_SCALE = 3.4;
export const SCENE_WIDTH = STAGE_WIDTH;
export const SCENE_HEIGHT = STAGE_HEIGHT;

/** Prototype pixels → stage pixels. */
export const u = (protoPx: number) => protoPx * SCENE_SCALE;

/** Absolute box from prototype coordinates, relative to its positioned parent. */
export const box = (left: number, top: number, width: number, height: number): CSSProperties => ({
  position: 'absolute',
  left: u(left),
  top: u(top),
  width: u(width),
  height: u(height),
});
