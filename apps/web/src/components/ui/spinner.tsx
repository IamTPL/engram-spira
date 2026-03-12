/**
 * Spinner — on-brand gradient ring loading indicator
 *
 * Uses a conic-gradient border trick so the ring fades from palette-5 (periwinkle)
 * to palette-1 (sky blue) around a transparent arc, giving a clean tail effect.
 *
 * Usage:
 *   <Spinner />                  ← md, default
 *   <Spinner size="lg" />
 *   <Spinner size="sm" label="Loading…" />
 */
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
    >
      {/*
        Gradient ring: padding-box fills with card bg so inner looks transparent,
        border-box receives the conic-gradient arc.
      */}
      <div
        class={`rounded-full ${s().ring} ${s().thickness} animate-spin`}
        style={{
          'border-color': 'transparent',
          background: `
            linear-gradient(var(--color-card, #fff), var(--color-card, #fff)) padding-box,
            conic-gradient(
              from 180deg,
              var(--color-palette-5, #8eb0fb) 0%,
              var(--color-palette-1, #8dccf5) 40%,
              color-mix(in srgb, var(--color-palette-5, #8eb0fb) 0%, transparent) 75%
            ) border-box
          `,
        }}
      />
      <Show when={props.label}>
        <span class="text-sm text-muted-foreground animate-pulse">
          {props.label}
        </span>
      </Show>
    </div>
  );
};

export default Spinner;
