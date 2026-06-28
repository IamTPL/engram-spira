import { type JSX, splitProps } from 'solid-js';
import { Dialog as DialogPrimitive } from '@kobalte/core/dialog';
import { X } from 'lucide-solid';
import { cn } from '@/lib/utils';

type DialogProps = Parameters<typeof DialogPrimitive>[0];

export function Dialog(props: DialogProps) {
  return <DialogPrimitive {...props} />;
}

type DialogContentProps = JSX.HTMLAttributes<HTMLDivElement>;

export function DialogContent(props: DialogContentProps) {
  const [local, others] = splitProps(props, ['class', 'children']);
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay class="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm animate-fade-in" />
      <div class="fixed inset-0 z-50 flex items-center justify-center p-4">
        <DialogPrimitive.Content
          class={cn(
            'relative z-50 grid w-full max-w-lg gap-4 rounded-lg border bg-background p-6 shadow-lg animate-scale-in',
            local.class,
          )}
          {...others}
        >
          {local.children}
        </DialogPrimitive.Content>
      </div>
    </DialogPrimitive.Portal>
  );
}

type DialogHeaderProps = JSX.HTMLAttributes<HTMLDivElement>;

export function DialogHeader(props: DialogHeaderProps) {
  const [local, others] = splitProps(props, ['class', 'children']);
  return (
    <div
      class={cn(
        'flex flex-col space-y-1.5 text-center sm:text-left',
        local.class,
      )}
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
    <DialogPrimitive.Title
      class={cn(
        'text-lg font-semibold leading-none tracking-tight',
        local.class,
      )}
      {...others}
    >
      {local.children}
    </DialogPrimitive.Title>
  );
}

type DialogDescriptionProps = JSX.HTMLAttributes<HTMLParagraphElement>;

export function DialogDescription(props: DialogDescriptionProps) {
  const [local, others] = splitProps(props, ['class', 'children']);
  return (
    <DialogPrimitive.Description
      class={cn('text-sm text-muted-foreground', local.class)}
      {...others}
    >
      {local.children}
    </DialogPrimitive.Description>
  );
}

type DialogFooterProps = JSX.HTMLAttributes<HTMLDivElement>;

export function DialogFooter(props: DialogFooterProps) {
  const [local, others] = splitProps(props, ['class', 'children']);
  return (
    <div
      class={cn(
        'flex flex-col-reverse gap-2 sm:flex-row sm:justify-end',
        local.class,
      )}
      {...others}
    >
      {local.children}
    </div>
  );
}

type DialogCloseProps = JSX.ButtonHTMLAttributes<HTMLButtonElement> & {
  onClose?: () => void;
};

function callClickHandler(
  handler: JSX.EventHandlerUnion<HTMLButtonElement, MouseEvent> | undefined,
  event: MouseEvent & {
    currentTarget: HTMLButtonElement;
    target: Element;
  },
) {
  if (!handler) return;

  if (typeof handler === 'function') {
    handler(event);
    return;
  }

  handler[0](handler[1], event);
}

export function DialogClose(props: DialogCloseProps) {
  const [local, others] = splitProps(props, [
    'class',
    'children',
    'onClose',
    'onClick',
  ]);

  const onClick: JSX.EventHandler<HTMLButtonElement, MouseEvent> = (event) => {
    callClickHandler(local.onClick, event);
    local.onClose?.();
  };

  return (
    <DialogPrimitive.CloseButton
      class={cn(
        'absolute right-4 top-4 rounded-sm opacity-70 transition-opacity hover:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none',
        local.class,
      )}
      {...others}
      onClick={onClick}
    >
      {local.children ?? (
        <>
          <X class="h-4 w-4" />
          <span class="sr-only">Close</span>
        </>
      )}
    </DialogPrimitive.CloseButton>
  );
}
