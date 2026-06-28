import { type Component, type JSX } from 'solid-js';
import { cn } from '@/lib/utils';

type PageShellProps = {
  children: JSX.Element;
  class?: string;
  /** Max-width constraint for the content area. Defaults to `max-w-content`. Set `false` to disable. */
  maxWidth?: string | false;
  /** Disable outer scroll on main-content. Use when the page manages its own scroll (e.g. VirtualList). */
  noScroll?: boolean;
};

const PageShell: Component<PageShellProps> = (props) => {
  const maxWidthClass = () => {
    if (props.maxWidth === false) return '';
    return props.maxWidth ?? 'max-w-content';
  };

  return (
    <div
      class={cn(
        'h-full min-h-0',
        props.noScroll ? 'flex flex-col overflow-hidden' : 'overflow-y-auto',
      )}
    >
      <div
        class={cn(
          props.noScroll
            ? 'flex min-h-0 flex-1 flex-col overflow-hidden'
            : 'mx-auto p-4 md:p-6',
          !props.noScroll && maxWidthClass(),
          props.class,
        )}
      >
        {props.children}
      </div>
    </div>
  );
};

export default PageShell;
