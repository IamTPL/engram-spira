import { cn } from '@/lib/utils';

export function getCheckboxLabelClass(className?: string) {
  return cn(
    'min-h-11 min-w-11 cursor-pointer data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50',
    className,
  );
}

export function getCheckboxRootClass(className?: string) {
  return cn(
    'group peer relative inline-flex items-center gap-2',
    getCheckboxLabelClass(),
    className,
  );
}
