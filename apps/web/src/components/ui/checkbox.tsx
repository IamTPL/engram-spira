import { type JSX, Show, splitProps } from 'solid-js';
import { Checkbox as CheckboxPrimitive } from '@kobalte/core/checkbox';
import { Check, Minus } from 'lucide-solid';
import { getCheckboxRootClass } from './checkbox-layout';

type CheckboxProps = Omit<Parameters<typeof CheckboxPrimitive>[0], 'children'> & {
  class?: string;
  children?: JSX.Element;
};

export function Checkbox(props: CheckboxProps) {
  const [local, inputProps, others] = splitProps(
    props,
    ['class', 'children'],
    ['aria-label', 'aria-labelledby', 'aria-describedby'],
  );

  return (
    <CheckboxPrimitive
      as="label"
      role={undefined}
      class={getCheckboxRootClass(local.class)}
      {...others}
    >
      {(state) => (
        <>
          <CheckboxPrimitive.Input {...inputProps} />
          <CheckboxPrimitive.Control
            class="pointer-events-none flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border border-primary shadow group-focus-within:outline-none group-focus-within:ring-1 group-focus-within:ring-ring data-[checked]:bg-primary data-[checked]:text-primary-foreground data-[indeterminate]:bg-primary data-[indeterminate]:text-primary-foreground"
          >
            <CheckboxPrimitive.Indicator>
              <Show
                when={state.indeterminate()}
                fallback={<Check class="h-3.5 w-3.5" />}
              >
                <Minus class="h-3.5 w-3.5" />
              </Show>
            </CheckboxPrimitive.Indicator>
          </CheckboxPrimitive.Control>
          {local.children}
        </>
      )}
    </CheckboxPrimitive>
  );
}
