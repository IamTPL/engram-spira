import { type JSX, splitProps } from 'solid-js';
import { Checkbox as CheckboxPrimitive } from '@kobalte/core/checkbox';
import { Check } from 'lucide-solid';
import { cn } from '@/lib/utils';

type CheckboxProps = Omit<Parameters<typeof CheckboxPrimitive>[0], 'children'> & {
  class?: string;
  children?: JSX.Element;
};

export function Checkbox(props: CheckboxProps) {
  const [local, others] = splitProps(props, ['class', 'children']);
  return (
    <CheckboxPrimitive
      class={cn('peer inline-flex items-center gap-2', local.class)}
      {...others}
    >
      <CheckboxPrimitive.Input />
      <CheckboxPrimitive.Control
        class={cn(
          'flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border border-primary shadow focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 data-[checked]:bg-primary data-[checked]:text-primary-foreground data-[indeterminate]:bg-primary data-[indeterminate]:text-primary-foreground',
        )}
      >
        <CheckboxPrimitive.Indicator>
          <Check class="h-3.5 w-3.5" />
        </CheckboxPrimitive.Indicator>
      </CheckboxPrimitive.Control>
      {local.children}
    </CheckboxPrimitive>
  );
}
