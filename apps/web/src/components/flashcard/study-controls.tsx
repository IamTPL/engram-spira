import { Info } from 'lucide-solid';
import { For, type Component } from 'solid-js';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';
import { KEYBOARD_SHORTCUTS } from '@/constants';

interface StudyControlsProps {
  onAgain: () => void;
  onHard: () => void;
  onGood: () => void;
  onEasy: () => void;
  disabled: boolean;
}

const StudyControls: Component<StudyControlsProps> = (props) => {
  const actions = [
    {
      label: 'Again',
      key: KEYBOARD_SHORTCUTS.AGAIN,
      onClick: props.onAgain,
      class:
        'bg-destructive text-destructive-foreground border-destructive/70 hover:bg-destructive/90',
    },
    {
      label: 'Hard',
      key: KEYBOARD_SHORTCUTS.HARD,
      onClick: props.onHard,
      class: 'bg-warning/10 text-warning border-warning/45 hover:bg-warning/20',
    },
    {
      label: 'Good',
      key: KEYBOARD_SHORTCUTS.GOOD,
      onClick: props.onGood,
      class: 'bg-success/15 text-success border-success/45 hover:bg-success/25',
    },
    {
      label: 'Easy',
      key: KEYBOARD_SHORTCUTS.EASY,
      onClick: props.onEasy,
      class:
        'btn-gradient text-slate-800 border border-primary/25 hover:opacity-95 dark:text-slate-900',
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
    <div class="relative mt-8 mx-auto w-full max-w-[28rem] pt-2">
      <div class="fixed top-20 right-6">
        <Tooltip
          content={ratingHelpText}
          side="left"
          class="min-w-[19rem] max-w-[24rem] whitespace-normal text-xs px-3.5 py-3"
        >
          <button
            type="button"
            class="inline-flex h-9 w-9 items-center justify-center rounded-full border border-primary/45 bg-gradient-to-br from-palette-1 to-palette-3 text-slate-800 shadow-md transition-smooth hover:scale-[1.03] hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            aria-label="Show help for Again, Hard, Good, and Easy buttons"
          >
            <Info class="h-4.5 w-4.5" />
          </button>
        </Tooltip>
      </div>

      <div class="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center sm:justify-center sm:gap-3">
        <For each={actions}>
          {(action) => (
            <Button
              variant="outline"
              size="lg"
              onClick={action.onClick}
              disabled={props.disabled}
              class={`h-auto min-h-11 min-w-[6.25rem] flex-1 flex-col gap-0.5 rounded-lg border py-2.5 shadow-sm transition-smooth active:translate-y-px sm:flex-none ${action.class}`}
            >
              <span class="text-sm font-semibold leading-none">
                {action.label}
              </span>
              <kbd class="text-[10px] font-mono opacity-70">{action.key}</kbd>
            </Button>
          )}
        </For>
      </div>
    </div>
  );
};

export default StudyControls;
