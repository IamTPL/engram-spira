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
  top: 'inset-x-0 top-0 max-h-[calc(100dvh-1rem)] border-b motion-safe:animate-slide-in-top',
  bottom:
    'inset-x-0 bottom-0 max-h-[calc(100dvh-1rem)] border-t motion-safe:animate-slide-in-bottom',
  left:
    'inset-y-0 left-0 h-full w-[calc(100%-1rem)] border-r motion-safe:animate-slide-in-left sm:max-w-sm',
  right:
    'inset-y-0 right-0 h-full w-[calc(100%-1rem)] border-l motion-safe:animate-slide-in sm:max-w-sm',
} as const;

type SheetContentProps = JSX.HTMLAttributes<HTMLDivElement> & {
  side?: keyof typeof sideClasses;
};

export function SheetContent(props: SheetContentProps) {
  const [local, others] = splitProps(props, ['class', 'children', 'side']);
  const side = () => local.side ?? 'right';

  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay class="fixed inset-0 z-50 bg-overlay motion-safe:animate-fade-in" />
      <DialogPrimitive.Content
        class={cn(
          'fixed z-50 flex flex-col gap-4 overflow-y-auto bg-popover p-5 text-popover-foreground shadow-xl sm:p-6',
          sideClasses[side()],
          local.class,
        )}
        {...others}
      >
        {local.children}
        <SheetClose class="absolute right-3 top-3" />
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
      class={cn('text-lg font-semibold leading-tight text-foreground', local.class)}
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
        'flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end',
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
        'inline-flex h-10 w-10 items-center justify-center rounded-md text-muted-foreground transition-[color,background-color,transform] duration-150 hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/25 active:translate-y-px disabled:pointer-events-none disabled:opacity-50',
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
