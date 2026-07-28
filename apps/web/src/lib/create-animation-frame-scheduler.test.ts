import { describe, expect, test } from 'bun:test';
import { createRoot } from 'solid-js';

import { createAnimationFrameScheduler } from './create-animation-frame-scheduler';

describe('cleanup-safe animation frame scheduler', () => {
  test('cancels every pending callback when its Solid owner is disposed', () => {
    const callbacks = new Map<number, FrameRequestCallback>();
    const cancelled: number[] = [];
    let nextId = 1;
    let schedule!: (callback: FrameRequestCallback) => number;
    let dispose!: () => void;

    createRoot((rootDispose) => {
      dispose = rootDispose;
      schedule = createAnimationFrameScheduler(
        (callback: FrameRequestCallback) => {
          const id = nextId;
          nextId += 1;
          callbacks.set(id, callback);
          return id;
        },
        (id: number) => {
          cancelled.push(id);
          callbacks.delete(id);
        },
      );
    });

    expect(schedule(() => {})).toBe(1);
    expect(schedule(() => {})).toBe(2);
    dispose();
    expect(cancelled).toEqual([1, 2]);
  });

  test('does not cancel a callback that already ran', () => {
    const callbacks = new Map<number, FrameRequestCallback>();
    const cancelled: number[] = [];
    let dispose!: () => void;

    createRoot((rootDispose) => {
      dispose = rootDispose;
      const schedule = createAnimationFrameScheduler(
          (callback: FrameRequestCallback) => {
            callbacks.set(1, callback);
            return 1;
          },
          (id: number) => cancelled.push(id),
        );
      schedule(() => {});
    });

    callbacks.get(1)?.(0);
    dispose();
    expect(cancelled).toEqual([]);
  });
});
