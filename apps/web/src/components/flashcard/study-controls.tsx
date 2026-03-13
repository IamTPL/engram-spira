import { type Component } from 'solid-js';
import { Button } from '@/components/ui/button';
import { KEYBOARD_SHORTCUTS } from '@/constants';

interface StudyControlsProps {
  onAgain: () => void;
  onHard: () => void;
  onGood: () => void;
  onEasy: () => void;
  disabled: boolean;
}

const StudyControls: Component<StudyControlsProps> = (props) => {
  return (
    <div class="flex items-center justify-center gap-3 mt-8 flex-wrap">
      <Button
        variant="destructive"
        size="lg"
        onClick={props.onAgain}
        disabled={props.disabled}
        class="min-w-24 flex-col gap-0.5 h-auto py-2.5"
      >
        <span class="text-sm font-semibold">Again</span>
        <kbd class="text-[10px] opacity-60 font-mono">
          {KEYBOARD_SHORTCUTS.AGAIN}
        </kbd>
      </Button>
      <Button
        variant="outline"
        size="lg"
        onClick={props.onHard}
        disabled={props.disabled}
        class="min-w-24 flex-col gap-0.5 h-auto py-2.5 border-warning/50 text-warning hover:bg-warning/10"
      >
        <span class="text-sm font-semibold">Hard</span>
        <kbd class="text-[10px] opacity-60 font-mono">
          {KEYBOARD_SHORTCUTS.HARD}
        </kbd>
      </Button>
      <Button
        variant="default"
        size="lg"
        onClick={props.onGood}
        disabled={props.disabled}
        class="min-w-24 flex-col gap-0.5 h-auto py-2.5 bg-success hover:bg-success/90 text-success-foreground"
      >
        <span class="text-sm font-semibold">Good</span>
        <kbd class="text-[10px] opacity-60 font-mono">
          {KEYBOARD_SHORTCUTS.GOOD}
        </kbd>
      </Button>
      <Button
        variant="default"
        size="lg"
        onClick={props.onEasy}
        disabled={props.disabled}
        class="min-w-24 flex-col gap-0.5 h-auto py-2.5 bg-primary hover:bg-primary/90 text-primary-foreground"
      >
        <span class="text-sm font-semibold">Easy</span>
        <kbd class="text-[10px] opacity-60 font-mono">
          {KEYBOARD_SHORTCUTS.EASY}
        </kbd>
      </Button>
    </div>
  );
};

export default StudyControls;
