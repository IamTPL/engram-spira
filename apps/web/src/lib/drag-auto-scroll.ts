const DEFAULT_EDGE_SIZE = 88;
const DEFAULT_MIN_SPEED = 120;
const DEFAULT_MAX_SPEED = 960;
const HORIZONTAL_TOLERANCE = 40;

type VerticalBounds = {
  top: number;
  bottom: number;
};

type EdgeScrollOptions = {
  edgeSize?: number;
  minSpeed?: number;
  maxSpeed?: number;
};

export function getEdgeScrollVelocity(
  pointerY: number,
  bounds: VerticalBounds,
  options: EdgeScrollOptions = {},
) {
  const height = Math.max(0, bounds.bottom - bounds.top);
  if (height === 0) return 0;

  const edgeSize = Math.min(
    options.edgeSize ?? DEFAULT_EDGE_SIZE,
    height / 2,
  );
  const minSpeed = options.minSpeed ?? DEFAULT_MIN_SPEED;
  const maxSpeed = options.maxSpeed ?? DEFAULT_MAX_SPEED;

  const velocityForDepth = (depth: number) => {
    const intensity = Math.min(1, Math.max(0, depth / edgeSize));
    return (
      minSpeed * intensity +
      (maxSpeed - minSpeed) * intensity * intensity
    );
  };

  const topEdge = bounds.top + edgeSize;
  if (pointerY < topEdge) {
    return -velocityForDepth(topEdge - pointerY);
  }

  const bottomEdge = bounds.bottom - edgeSize;
  if (pointerY > bottomEdge) {
    return velocityForDepth(pointerY - bottomEdge);
  }

  return 0;
}

type DragAutoScroller = {
  updatePointer: (clientX: number, clientY: number) => void;
  stop: () => void;
};

export function createDragAutoScroller(
  getContainer: () => HTMLElement | undefined,
  onScroll?: (clientX: number, clientY: number) => void,
): DragAutoScroller {
  let frameId: number | null = null;
  let lastFrameTime: number | null = null;
  let velocity = 0;
  let pointerX = 0;
  let pointerY = 0;

  const stopFrame = () => {
    if (frameId !== null) cancelAnimationFrame(frameId);
    frameId = null;
    lastFrameTime = null;
  };

  const runFrame = (timestamp: number) => {
    const container = getContainer();
    if (!container || velocity === 0) {
      stopFrame();
      return;
    }

    if (lastFrameTime === null) {
      lastFrameTime = timestamp;
      frameId = requestAnimationFrame(runFrame);
      return;
    }

    const elapsedSeconds = Math.min(
      (timestamp - lastFrameTime) / 1000,
      0.05,
    );
    lastFrameTime = timestamp;

    const maxScrollTop = Math.max(
      0,
      container.scrollHeight - container.clientHeight,
    );
    const nextScrollTop = Math.min(
      maxScrollTop,
      Math.max(0, container.scrollTop + velocity * elapsedSeconds),
    );

    if (nextScrollTop === container.scrollTop) {
      stopFrame();
      return;
    }

    container.scrollTop = nextScrollTop;
    onScroll?.(pointerX, pointerY);
    frameId = requestAnimationFrame(runFrame);
  };

  const startFrame = () => {
    if (frameId !== null || velocity === 0) return;
    frameId = requestAnimationFrame(runFrame);
  };

  return {
    updatePointer(clientX, clientY) {
      pointerX = clientX;
      pointerY = clientY;
      const container = getContainer();
      if (!container) {
        velocity = 0;
        stopFrame();
        return;
      }

      const bounds = container.getBoundingClientRect();
      const isHorizontallyAligned =
        clientX >= bounds.left - HORIZONTAL_TOLERANCE &&
        clientX <= bounds.right + HORIZONTAL_TOLERANCE;

      velocity = isHorizontallyAligned
        ? getEdgeScrollVelocity(clientY, bounds)
        : 0;

      if (velocity === 0) {
        stopFrame();
      } else {
        startFrame();
      }
    },
    stop() {
      velocity = 0;
      stopFrame();
    },
  };
}
