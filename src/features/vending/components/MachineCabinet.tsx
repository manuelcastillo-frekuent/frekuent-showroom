import type { ReactNode } from 'react';
import { SCENE_HEIGHT, SCENE_WIDTH, u } from '@/shared/stage/scene';
import { C } from './palette';

const WIDTH = 410;
const HEIGHT = 1043;

/**
 * Room (wall and floor) plus the machine's body and base. Children are laid
 * out with `box()` in prototype coordinates relative to the body.
 */
export function MachineCabinet({ children }: { children: ReactNode }) {
  return (
    <div
      className="abs"
      style={{
        top: 0,
        left: 0,
        width: SCENE_WIDTH,
        height: SCENE_HEIGHT,
        overflow: 'hidden',
        background: C.wall,
      }}
    >
      <div
        className="abs"
        style={{ left: 0, right: 0, bottom: 0, height: u(45), background: C.floor }}
      />

      <div
        style={{
          // Same proportions as the prototype, standing on the floor; the spare
          // height above is wall.
          position: 'absolute',
          left: (SCENE_WIDTH - u(WIDTH)) / 2,
          top: SCENE_HEIGHT - u(HEIGHT),
          width: u(WIDTH),
          height: u(HEIGHT),
          background: C.body,
          borderRadius: `${u(14)}px ${u(14)}px ${u(4)}px ${u(4)}px`,
          boxShadow: `0 ${u(18)}px ${u(30)}px rgba(26,25,37,.3)`,
        }}
      >
        {children}

        <div
          className="abs"
          style={{
            left: 0,
            right: 0,
            bottom: 0,
            height: u(40),
            background: C.base,
            borderRadius: `0 0 ${u(4)}px ${u(4)}px`,
          }}
        />
      </div>
    </div>
  );
}
