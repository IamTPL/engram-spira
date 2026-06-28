import { type JSX, splitProps } from 'solid-js';
import { Dialog as DialogPrimitive } from '@kobalte/core/dialog';
import { X } from 'lucide-solid';
import { cn } from '@/lib/utils';

type SheetProps = Parameters<typeof DialogPrimitive>[0];

export function Sheet(props: SheetProps) {
  return <DialogPrimitive {...props} />;
}

type SheetTriggerProps = Parameters<typeof DialogPrimitive.Trigger>[0];

export function SheetTrigger(props: SheetTriggerProps) {
  return <DialogPrimitive.Trigger {...props} />;
}

const sideClasses = {
  top: 'inset-x-0 top-0 border-b',
  bottom: 'inset-x-0 bottom-0 border-t',
  left: 'inset-y-0 left-0 h-full w-3/4 border-r sm:max-w-sm',
  right: 'inset-y-0 right-0 h-full w-3/4 border-l sm:max-w-sm',
} as const;

type SheetContentProps = JSX.HTMLAttributes<HTMLDivElement> & {
  side?: keyof typeof sideClasses;
};

export function SheetContent(props: SheetContentProps) {
  const [local, others] = splitProps(props, ['class', 'children', 'side']);
  const side = () => local.side ?? 'right';

  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay class="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm animate-fade-in" />
      <DialogPrimitive.Content
        class={cn(
          'fixed z-50 gap-4 bg-background p-6 shadow-lg animate-slide-in',
          sideClasses[side()],
          local.class,
        )}
        {...others}
      >
        {local.children}
        <SheetClose class="absolute right-4 top-4" />
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

type SheetHeaderProps = JSX.HTMLAttributes<HTMLDivElement>;

export function SheetHeader(props: SheetHeaderProps) {
  const [local, others] = splitProps(props, ['class', 'children']);
  return (
    <div
      class={cn('flex flex-col space-y-2 text-center sm:text-left', local.class)}
      {...others}
    >
      {local.children}
    </div>
  );
}

type SheetTitleProps = JSX.HTMLAttributes<HTMLHeadingElement>;

export function SheetTitle(props: SheetTitleProps) {
  const [local, others] = splitProps(props, ['class', 'children']);
  return (
    <DialogPrimitive.Title
      class={cn('text-lg font-semibold text-foreground', local.class)}
      {...others}
    >
      {local.children}
    </DialogPrimitive.Title>
  );
}

type SheetDescriptionProps = JSX.HTMLAttributes<HTMLParagraphElement>;

export function SheetDescription(props: SheetDescriptionProps) {
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

type SheetFooterProps = JSX.HTMLAttributes<HTMLDivElement>;

export function SheetFooter(props: SheetFooterProps) {
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

type SheetCloseProps = JSX.ButtonHTMLAttributes<HTMLButtonElement>;

export function SheetClose(props: SheetCloseProps) {
  const [local, others] = splitProps(props, ['class', 'children']);
  return (
    <DialogPrimitive.CloseButton
      class={cn(
        'rounded-sm opacity-70 transition-opacity hover:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none',
        local.class,
      )}
      {...others}
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
