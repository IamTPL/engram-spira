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
        props.noScroll
          ? 'flex flex-col overflow-hidden'
          : 'overflow-y-auto overscroll-contain',
      )}
    >
      <div
        class={cn(
          props.noScroll
            ? 'flex min-h-0 w-full flex-1 flex-col overflow-hidden'
            : 'mx-auto w-full px-4 py-5 sm:px-5 sm:py-6 md:px-6 md:py-7 lg:px-8 lg:py-8',
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
