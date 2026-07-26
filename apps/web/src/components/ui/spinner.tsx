/** Accessible neutral loading indicator. */
import { type Component, Show } from 'solid-js';

type SpinnerSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

interface SpinnerProps {
  size?: SpinnerSize;
  /** Accessible label shown below the spinner (optional) */
  label?: string;
  class?: string;
}

const sizeMap: Record<SpinnerSize, { ring: string; thickness: string }> = {
  xs: { ring: 'h-4 w-4', thickness: 'border-[2px]' },
  sm: { ring: 'h-5 w-5', thickness: 'border-[2px]' },
  md: { ring: 'h-8 w-8', thickness: 'border-[2.5px]' },
  lg: { ring: 'h-12 w-12', thickness: 'border-[3px]' },
  xl: { ring: 'h-16 w-16', thickness: 'border-[3.5px]' },
};

export const Spinner: Component<SpinnerProps> = (props) => {
  const s = () => sizeMap[props.size ?? 'md'];

  return (
    <div
      class={`flex flex-col items-center gap-3 ${props.class ?? ''}`}
      role="status"
      aria-label={props.label ?? 'Loading'}
      aria-live="polite"
    >
      <div
        class={`rounded-full border-muted-foreground/20 border-t-foreground ${s().ring} ${s().thickness} motion-safe:animate-spin`}
      />
      <Show when={props.label}>
        <span class="text-sm text-muted-foreground">
          {props.label}
        </span>
      </Show>
    </div>
  );
};

export default Spinner;
