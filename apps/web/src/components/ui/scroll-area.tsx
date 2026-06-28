import { type JSX, splitProps } from 'solid-js';
import { cn } from '@/lib/utils';

type ScrollAreaProps = JSX.HTMLAttributes<HTMLDivElement>;

export function ScrollArea(props: ScrollAreaProps) {
  const [local, others] = splitProps(props, ['class', 'children']);
  return (
    <div class={cn('relative overflow-hidden', local.class)} {...others}>
      <div class="h-full w-full overflow-auto">{local.children}</div>
    </div>
  );
}
