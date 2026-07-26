import { type JSX, splitProps } from 'solid-js';
import { cn } from '@/lib/utils';

const cardVariants = {
  default: 'rounded-xl border bg-card text-card-foreground shadow-xs',
  elevated: 'rounded-xl border bg-card text-card-foreground shadow-md',
  outlined: 'rounded-xl border bg-card text-card-foreground shadow-none',
  ghost: 'rounded-xl bg-transparent text-card-foreground shadow-none',
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
        local.interactive &&
          'cursor-pointer transition-[background-color,border-color,box-shadow,transform] duration-150 ease-out hover:border-muted-foreground/35 hover:bg-accent/35 hover:shadow-sm active:translate-y-px',
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
    <div
      class={cn('flex flex-col space-y-1.5 p-5 pb-3 sm:p-6 sm:pb-3', local.class)}
      {...others}
    >
      {local.children}
    </div>
  );
}

export function CardTitle(props: JSX.HTMLAttributes<HTMLHeadingElement>) {
  const [local, others] = splitProps(props, ['class', 'children']);
  return (
    <h3
      class={cn('text-xl font-semibold leading-tight tracking-tight', local.class)}
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
    <div class={cn('p-5 pt-0 sm:p-6 sm:pt-0', local.class)} {...others}>
      {local.children}
    </div>
  );
}

export function CardFooter(props: JSX.HTMLAttributes<HTMLDivElement>) {
  const [local, others] = splitProps(props, ['class', 'children']);
  return (
    <div class={cn('flex items-center p-5 pt-0 sm:p-6 sm:pt-0', local.class)} {...others}>
      {local.children}
    </div>
  );
}
