import { Info } from 'lucide-solid';
import { For, type Component } from 'solid-js';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';
import { KEYBOARD_SHORTCUTS } from '@/constants';
import { cn } from '@/lib/utils';

interface StudyControlsProps {
  onAgain: () => void;
  onHard: () => void;
  onGood: () => void;
  onEasy: () => void;
  disabled: boolean;
  visible: boolean;
}

const StudyControls: Component<StudyControlsProps> = (props) => {
  const actions = [
    {
      label: 'Again',
      description: 'Forgot',
      key: KEYBOARD_SHORTCUTS.AGAIN,
      onClick: () => props.onAgain(),
      class:
        'border-destructive bg-destructive text-destructive-foreground hover:border-destructive/90 hover:bg-destructive/90 focus-visible:ring-destructive/35',
    },
    {
      label: 'Hard',
      description: 'With effort',
      key: KEYBOARD_SHORTCUTS.HARD,
      onClick: () => props.onHard(),
      class:
        'border-destructive/35 bg-destructive-surface text-destructive hover:border-destructive/55 hover:bg-destructive/15 focus-visible:ring-destructive/25',
    },
    {
      label: 'Good',
      description: 'Remembered',
      key: KEYBOARD_SHORTCUTS.GOOD,
      onClick: () => props.onGood(),
      class:
        'border-muted-foreground/35 bg-muted text-foreground hover:border-muted-foreground/55 hover:bg-accent focus-visible:ring-muted-foreground/30',
    },
    {
      label: 'Easy',
      description: 'Instantly',
      key: KEYBOARD_SHORTCUTS.EASY,
      onClick: () => props.onEasy(),
      class:
        'border-hero bg-hero text-hero-foreground hover:border-foreground/35 hover:bg-hero/90 focus-visible:ring-foreground/30',
    },
  ] as const;

  const ratingHelpText = (
    <div class="space-y-2">
      <p class="leading-5">
        <span class="font-semibold text-background">Again:</span>{' '}
        <span class="text-background/85">You got it wrong or forgot.</span>
      </p>
      <p class="leading-5">
        <span class="font-semibold text-background">Hard:</span>{' '}
        <span class="text-background/85">You remembered with effort.</span>
      </p>
      <p class="leading-5">
        <span class="font-semibold text-background">Good:</span>{' '}
        <span class="text-background/85">You remembered at a normal pace.</span>
      </p>
      <p class="leading-5">
        <span class="font-semibold text-background">Easy:</span>{' '}
        <span class="text-background/85">
          You recalled it instantly and confidently.
        </span>
      </p>
    </div>
  );

  return (
    <div
      class="mx-auto mt-5 w-full max-w-2xl"
      aria-hidden={!props.visible}
    >
      <div
        class={cn(
          'transition-[opacity,transform] duration-200 ease-out motion-reduce:transform-none motion-reduce:transition-none',
          props.visible
            ? 'translate-y-0 opacity-100'
            : 'pointer-events-none translate-y-1 opacity-0',
        )}
      >
        <div class="mb-3 flex items-center justify-between gap-3">
          <p class="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Rate your recall
          </p>
          <Tooltip
            content={ratingHelpText}
            side="top"
            class="max-w-[min(24rem,calc(100vw-2rem))] whitespace-normal px-3.5 py-3 text-xs"
          >
            <button
              type="button"
              class="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 disabled:pointer-events-none"
              aria-label="Show help for Again, Hard, Good, and Easy buttons"
              disabled={!props.visible}
            >
              <Info class="h-4 w-4" />
            </button>
          </Tooltip>
        </div>

        <div
          class="grid grid-cols-2 gap-2 sm:grid-cols-4"
          role="group"
          aria-label="Rate your recall"
        >
          <For each={actions}>
            {(action) => (
              <Button
                variant="outline"
                size="lg"
                onClick={action.onClick}
                disabled={props.disabled || !props.visible}
                aria-label={`${action.label}: ${action.description}. Keyboard shortcut ${action.key}`}
                class={`h-auto min-h-16 flex-col items-stretch gap-2 rounded-lg border px-3 py-3 text-left shadow-xs hover:-translate-y-0.5 active:translate-y-px ${action.class}`}
              >
                <span class="flex w-full items-center justify-between gap-2">
                  <span class="text-sm font-semibold leading-none">
                    {action.label}
                  </span>
                  <kbd class="rounded border border-current/25 bg-transparent px-1.5 py-0.5 font-mono text-[10px] font-semibold leading-none">
                    {action.key}
                  </kbd>
                </span>
                <span class="text-[11px] font-medium leading-none opacity-75">
                  {action.description}
                </span>
              </Button>
            )}
          </For>
        </div>
      </div>
    </div>
  );
};

export default StudyControls;
