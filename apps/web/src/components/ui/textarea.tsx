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
        'flex min-h-[80px] w-full rounded-md border bg-transparent px-3 py-2 text-sm shadow-sm transition-all duration-[--duration-normal] placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50',
        local.error
          ? 'border-destructive focus-visible:ring-destructive'
          : 'border-input',
        local.class,
      )}
      {...others}
    />
  );
}
