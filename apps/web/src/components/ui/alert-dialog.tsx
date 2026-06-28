import { type JSX, splitProps } from 'solid-js';
import { AlertDialog as AlertDialogPrimitive } from '@kobalte/core/alert-dialog';
import { cn } from '@/lib/utils';
import { buttonVariants } from './button';

type AlertDialogProps = Parameters<typeof AlertDialogPrimitive>[0];

export function AlertDialog(props: AlertDialogProps) {
  return <AlertDialogPrimitive {...props} />;
}

type AlertDialogTriggerProps = Parameters<typeof AlertDialogPrimitive.Trigger>[0];

export function AlertDialogTrigger(props: AlertDialogTriggerProps) {
  return <AlertDialogPrimitive.Trigger {...props} />;
}

type AlertDialogContentProps = JSX.HTMLAttributes<HTMLDivElement>;

export function AlertDialogContent(props: AlertDialogContentProps) {
  const [local, others] = splitProps(props, ['class', 'children']);
  return (
    <AlertDialogPrimitive.Portal>
      <AlertDialogPrimitive.Overlay class="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm animate-fade-in" />
      <div class="fixed inset-0 z-50 flex items-center justify-center p-4">
        <AlertDialogPrimitive.Content
          class={cn(
            'relative z-50 grid w-full max-w-lg gap-4 rounded-lg border bg-background p-6 shadow-lg animate-scale-in',
            local.class,
          )}
          {...others}
        >
          {local.children}
        </AlertDialogPrimitive.Content>
      </div>
    </AlertDialogPrimitive.Portal>
  );
}

type AlertDialogHeaderProps = JSX.HTMLAttributes<HTMLDivElement>;

export function AlertDialogHeader(props: AlertDialogHeaderProps) {
  const [local, others] = splitProps(props, ['class', 'children']);
  return (
    <div
      class={cn(
        'flex flex-col space-y-2 text-center sm:text-left',
        local.class,
      )}
      {...others}
    >
      {local.children}
    </div>
  );
}

type AlertDialogTitleProps = JSX.HTMLAttributes<HTMLHeadingElement>;

export function AlertDialogTitle(props: AlertDialogTitleProps) {
  const [local, others] = splitProps(props, ['class', 'children']);
  return (
    <AlertDialogPrimitive.Title
      class={cn('text-lg font-semibold', local.class)}
      {...others}
    >
      {local.children}
    </AlertDialogPrimitive.Title>
  );
}

type AlertDialogDescriptionProps = JSX.HTMLAttributes<HTMLParagraphElement>;

export function AlertDialogDescription(props: AlertDialogDescriptionProps) {
  const [local, others] = splitProps(props, ['class', 'children']);
  return (
    <AlertDialogPrimitive.Description
      class={cn('text-sm text-muted-foreground', local.class)}
      {...others}
    >
      {local.children}
    </AlertDialogPrimitive.Description>
  );
}

type AlertDialogFooterProps = JSX.HTMLAttributes<HTMLDivElement>;

export function AlertDialogFooter(props: AlertDialogFooterProps) {
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

type AlertDialogActionProps = JSX.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'destructive';
};

export function AlertDialogAction(props: AlertDialogActionProps) {
  const [local, others] = splitProps(props, [
    'class',
    'children',
    'variant',
  ]);
  return (
    <AlertDialogPrimitive.CloseButton
      class={cn(
        buttonVariants({ variant: local.variant ?? 'default' }),
        local.class,
      )}
      {...others}
    >
      {local.children}
    </AlertDialogPrimitive.CloseButton>
  );
}

type AlertDialogCancelProps = JSX.ButtonHTMLAttributes<HTMLButtonElement>;

export function AlertDialogCancel(props: AlertDialogCancelProps) {
  const [local, others] = splitProps(props, ['class', 'children']);
  return (
    <AlertDialogPrimitive.CloseButton
      class={cn(
        buttonVariants({ variant: 'outline' }),
        'mt-2 sm:mt-0',
        local.class,
      )}
      {...others}
    >
      {local.children}
    </AlertDialogPrimitive.CloseButton>
  );
}
