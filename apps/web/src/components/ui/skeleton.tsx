import type { Component, JSX } from 'solid-js';

const Skeleton: Component<{ class?: string; style?: JSX.CSSProperties }> = (props) => (
  <div
    class={`animate-pulse rounded-md bg-muted ${props.class ?? ''}`}
    style={props.style}
  />
);

export default Skeleton;
