import { type JSX, splitProps } from 'solid-js';
import { cn } from '@/lib/utils';

const cardVariants = {
  default: 'rounded-xl border bg-card text-card-foreground shadow-sm',
  elevated: 'rounded-xl bg-card text-card-foreground shadow-md',
  outlined: 'rounded-xl border bg-transparent text-card-foreground',
  ghost: 'rounded-xl bg-transparent text-card-foreground',
} as const;

type CardProps = JSX.HTMLAttributes<HTMLDivElement> & {
  variant?: keyof typeof cardVariants;
  interactive?: boolean;
};

export function Card(props: CardProps) {
  const [local, others] = splitProps(props, [
    'class',
    'children',
    'variant',
    'interactive',
  ]);
  return (
    <div
      class={cn(
        cardVariants[local.variant ?? 'default'],
        local.interactive && 'hover-lift cursor-pointer',
        local.class,
      )}
      {...others}
    >
      {local.children}
    </div>
  );
}

export function CardHeader(props: JSX.HTMLAttributes<HTMLDivElement>) {
  const [local, others] = splitProps(props, ['class', 'children']);
  return (
    <div class={cn('flex flex-col space-y-1.5 p-6', local.class)} {...others}>
      {local.children}
    </div>
  );
}

export function CardTitle(props: JSX.HTMLAttributes<HTMLHeadingElement>) {
  const [local, others] = splitProps(props, ['class', 'children']);
  return (
    <h3
      class={cn('font-semibold leading-none tracking-tight', local.class)}
      {...others}
    >
      {local.children}
    </h3>
  );
}

export function CardDescription(
  props: JSX.HTMLAttributes<HTMLParagraphElement>,
) {
  const [local, others] = splitProps(props, ['class', 'children']);
  return (
    <p class={cn('text-sm text-muted-foreground', local.class)} {...others}>
      {local.children}
    </p>
  );
}

export function CardContent(props: JSX.HTMLAttributes<HTMLDivElement>) {
  const [local, others] = splitProps(props, ['class', 'children']);
  return (
    <div class={cn('p-6 pt-0', local.class)} {...others}>
      {local.children}
    </div>
  );
}

export function CardFooter(props: JSX.HTMLAttributes<HTMLDivElement>) {
  const [local, others] = splitProps(props, ['class', 'children']);
  return (
    <div class={cn('flex items-center p-6 pt-0', local.class)} {...others}>
      {local.children}
    </div>
  );
}
