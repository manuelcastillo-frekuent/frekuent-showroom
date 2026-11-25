/**
 * Shared clock for the dispense: the spiral (CSS, in its slot) and the flying
 * product (Web Animations, over the cabinet) run separately and must line up.
 */
export const SPIRAL_TURNS = 2;
export const SPIRAL_TURN_MS = 600;
export const SPIRAL_MS = SPIRAL_TURNS * SPIRAL_TURN_MS;

export const ZOOM_MS = 400;
export const FALL_MS = 900;
export const LAND_MS = 400;
export const DISPENSE_MS = SPIRAL_MS + ZOOM_MS + FALL_MS + LAND_MS;
