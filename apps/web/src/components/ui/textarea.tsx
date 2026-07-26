import { type JSX, splitProps } from 'solid-js';
import { cn } from '@/lib/utils';

type TextareaProps = JSX.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  error?: boolean;
};

export function Textarea(props: TextareaProps) {
  const [local, others] = splitProps(props, ['class', 'error']);
  return (
    <textarea
      class={cn(
        'flex min-h-24 w-full resize-y rounded-md border bg-card px-3 py-2.5 text-base text-foreground shadow-xs transition-[background-color,border-color,box-shadow] duration-150 placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/20 disabled:cursor-not-allowed disabled:bg-muted/60 disabled:text-muted-foreground disabled:opacity-70 md:text-sm',
        local.error
          ? 'border-destructive focus-visible:border-destructive focus-visible:ring-destructive/20'
          : 'border-input',
        local.class,
      )}
      aria-invalid={local.error || undefined}
      {...others}
    />
  );
}
