import { type Component, type JSX, splitProps } from 'solid-js';
import { cn } from '@/lib/utils';

const shapeClasses = {
  text: 'rounded-md h-4 w-full',
  circular: 'rounded-full',
  rectangular: 'rounded-md',
  card: 'rounded-xl h-32 w-full',
} as const;

type SkeletonProps = JSX.HTMLAttributes<HTMLDivElement> & {
  class?: string;
  style?: JSX.CSSProperties;
  shape?: keyof typeof shapeClasses;
  width?: string;
  height?: string;
};

const Skeleton: Component<SkeletonProps> = (props) => {
  const [local, others] = splitProps(props, [
    'class',
    'shape',
    'width',
    'height',
    'style',
  ]);

  const style = () => ({
    ...(local.width ? { width: local.width } : {}),
    ...(local.height ? { height: local.height } : {}),
    ...(typeof local.style === 'object' ? local.style : {}),
  });

  return (
    <div
      class={cn(
        'animate-pulse bg-muted',
        shapeClasses[local.shape ?? 'rectangular'],
        local.class,
      )}
      style={style()}
      {...others}
    />
  );
};

export default Skeleton;
export { Skeleton };
