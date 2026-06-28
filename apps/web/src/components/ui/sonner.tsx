import 'solid-sonner/styles.css';

import { mergeProps } from 'solid-js';
import {
  Toaster as SonnerToaster,
  toast,
  type ToasterProps,
} from 'solid-sonner';

function Toaster(props: ToasterProps) {
  const merged = mergeProps(
    {
      theme: 'system' as const,
      position: 'bottom-right' as const,
      closeButton: true,
      richColors: true,
      toastOptions: {
        classNames: {
          toast:
            'border border-border bg-background text-foreground shadow-lg',
          title: 'text-sm font-medium',
          description: 'text-sm text-muted-foreground',
          actionButton: 'bg-primary text-primary-foreground',
          cancelButton: 'bg-muted text-muted-foreground',
        },
      },
    },
    props,
  );

  return <SonnerToaster {...merged} />;
}

export { Toaster, toast };
export default Toaster;
