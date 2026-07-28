import { onCleanup } from 'solid-js';

type RequestFrame = (callback: FrameRequestCallback) => number;
type CancelFrame = (frameId: number) => void;

export function createAnimationFrameScheduler(
  requestFrame: RequestFrame = requestAnimationFrame,
  cancelFrame: CancelFrame = cancelAnimationFrame,
): (callback: FrameRequestCallback) => number {
  const pendingFrameIds = new Set<number>();

  const schedule = (callback: FrameRequestCallback) => {
    let frameId = 0;
    frameId = requestFrame((time) => {
      pendingFrameIds.delete(frameId);
      callback(time);
    });
    pendingFrameIds.add(frameId);
    return frameId;
  };

  onCleanup(() => {
    for (const frameId of pendingFrameIds) cancelFrame(frameId);
    pendingFrameIds.clear();
  });

  return schedule;
}
