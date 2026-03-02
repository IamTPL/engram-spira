import { type Component } from 'solid-js';
import { Button } from '@/components/ui/button';
import { KEYBOARD_SHORTCUTS } from '@/constants';

interface StudyControlsProps {
  onAgain: () => void;
  onHard: () => void;
  onGood: () => void;
  disabled: boolean;
}

const StudyControls: Component<StudyControlsProps> = (props) => {
  return (
    <div class="flex items-center justify-center gap-4 mt-8">
      <Button
        variant="destructive"
        size="lg"
        onClick={props.onAgain}
        disabled={props.disabled}
        class="min-w-25"
      >
        <span class="mr-2 text-xs opacity-60">{KEYBOARD_SHORTCUTS.AGAIN}</span>
        Again
      </Button>
      <Button
        variant="outline"
        size="lg"
        onClick={props.onHard}
        disabled={props.disabled}
        class="min-w-25"
      >
        <span class="mr-2 text-xs opacity-60">{KEYBOARD_SHORTCUTS.HARD}</span>
        Hard
      </Button>
      <Button
        variant="default"
        size="lg"
        onClick={props.onGood}
        disabled={props.disabled}
        class="min-w-25 bg-success hover:bg-success/90 text-success-foreground"
      >
        <span class="mr-2 text-xs opacity-60">{KEYBOARD_SHORTCUTS.GOOD}</span>
        Good
      </Button>
    </div>
  );
};

export default StudyControls;
