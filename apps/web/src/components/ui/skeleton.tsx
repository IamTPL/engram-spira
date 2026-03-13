import type { Component, JSX } from 'solid-js';
import { cn } from '@/lib/utils';

const shapeClasses = {
  text: 'rounded-md h-4 w-full',
  circular: 'rounded-full',
  rectangular: 'rounded-md',
  card: 'rounded-xl h-32 w-full',
} as const;

const Skeleton: Component<{
  class?: string;
  style?: JSX.CSSProperties;
  shape?: keyof typeof shapeClasses;
  width?: string;
  height?: string;
}> = (props) => (
  <div
    class={cn(
      'animate-pulse bg-muted',
      shapeClasses[props.shape ?? 'rectangular'],
      props.class,
    )}
    style={{
      ...(props.width ? { width: props.width } : {}),
      ...(props.height ? { height: props.height } : {}),
      ...props.style,
    }}
  />
);

export default Skeleton;
