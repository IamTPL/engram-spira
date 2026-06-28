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
        'flex min-h-20 w-full rounded-md border bg-background px-3 py-2 text-base shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm',
        local.error
          ? 'border-destructive focus-visible:ring-destructive'
          : 'border-input',
        local.class,
      )}
      {...others}
    />
  );
}
