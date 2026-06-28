import { type JSX, splitProps } from 'solid-js';
import { Switch as SwitchPrimitive } from '@kobalte/core/switch';
import { cn } from '@/lib/utils';

type SwitchProps = Omit<Parameters<typeof SwitchPrimitive>[0], 'children'> & {
  class?: string;
  children?: JSX.Element;
};

export function Switch(props: SwitchProps) {
  const [local, others] = splitProps(props, ['class', 'children']);
  return (
    <SwitchPrimitive
      class={cn('peer inline-flex items-center gap-2', local.class)}
      {...others}
    >
      <SwitchPrimitive.Input />
      <SwitchPrimitive.Control class="inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent bg-input shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 data-[checked]:bg-primary">
        <SwitchPrimitive.Thumb class="pointer-events-none block h-4 w-4 rounded-full bg-background shadow-lg ring-0 transition-transform data-[checked]:translate-x-4" />
      </SwitchPrimitive.Control>
      {local.children}
    </SwitchPrimitive>
  );
}
