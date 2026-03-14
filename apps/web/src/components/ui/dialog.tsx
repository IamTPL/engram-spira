import {
  type Component,
  type JSX,
  Show,
  splitProps,
  createEffect,
  onCleanup,
} from 'solid-js';
import { Portal } from 'solid-js/web';
import { cn } from '@/lib/utils';
import { X } from 'lucide-solid';

type DialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: JSX.Element;
};

export const Dialog: Component<DialogProps> = (props) => {
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') props.onOpenChange(false);
  };

  createEffect(() => {
    if (props.open) {
      document.addEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'hidden';
    } else {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    }
  });

  onCleanup(() => {
    document.removeEventListener('keydown', handleKeyDown);
    document.body.style.overflow = '';
  });

  return (
    <Show when={props.open}>
      <Portal>
        <div class="fixed inset-0 z-50 flex items-center justify-center">
          {/* Backdrop */}
          <div
            class="absolute inset-0 overlay-backdrop animate-fade-in"
            onClick={() => props.onOpenChange(false)}
          />
          {/* Content */}
          <div class="relative z-10 animate-scale-in">{props.children}</div>
        </div>
      </Portal>
    </Show>
  );
};

type DialogContentProps = JSX.HTMLAttributes<HTMLDivElement>;

export function DialogContent(props: DialogContentProps) {
  const [local, others] = splitProps(props, ['class', 'children']);
  return (
    <div
      class={cn(
        'w-full max-w-lg mx-4 rounded-xl border bg-card p-6 shadow-xl',
        local.class,
      )}
      role="dialog"
      aria-modal="true"
      {...others}
    >
      {local.children}
    </div>
  );
}

type DialogHeaderProps = JSX.HTMLAttributes<HTMLDivElement>;

export function DialogHeader(props: DialogHeaderProps) {
  const [local, others] = splitProps(props, ['class', 'children']);
  return (
    <div
      class={cn('flex flex-col space-y-1.5 mb-4', local.class)}
      {...others}
    >
      {local.children}
    </div>
  );
}

type DialogTitleProps = JSX.HTMLAttributes<HTMLHeadingElement>;

export function DialogTitle(props: DialogTitleProps) {
  const [local, others] = splitProps(props, ['class', 'children']);
  return (
    <h2
      class={cn('text-lg font-semibold leading-none tracking-tight', local.class)}
      {...others}
    >
      {local.children}
    </h2>
  );
}

type DialogDescriptionProps = JSX.HTMLAttributes<HTMLParagraphElement>;

export function DialogDescription(props: DialogDescriptionProps) {
  const [local, others] = splitProps(props, ['class', 'children']);
  return (
    <p
      class={cn('text-sm text-muted-foreground', local.class)}
      {...others}
    >
      {local.children}
    </p>
  );
}

type DialogFooterProps = JSX.HTMLAttributes<HTMLDivElement>;

export function DialogFooter(props: DialogFooterProps) {
  const [local, others] = splitProps(props, ['class', 'children']);
  return (
    <div
      class={cn(
        'flex flex-col-reverse sm:flex-row sm:justify-end gap-2 mt-6',
        local.class,
      )}
      {...others}
    >
      {local.children}
    </div>
  );
}

type DialogCloseProps = JSX.ButtonHTMLAttributes<HTMLButtonElement> & {
  onClose: () => void;
};

export function DialogClose(props: DialogCloseProps) {
  const [local, others] = splitProps(props, ['class', 'onClose']);
  return (
    <button
      class={cn(
        'absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 cursor-pointer',
        local.class,
      )}
      onClick={local.onClose}
      {...others}
    >
      <X class="h-4 w-4" />
      <span class="sr-only">Close</span>
    </button>
  );
}
