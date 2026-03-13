import { type Component, type JSX, splitProps } from 'solid-js';
import { cn } from '@/lib/utils';
import Sidebar from './sidebar';
import MobileNav from './mobile-nav';

type PageShellProps = {
  children: JSX.Element;
  class?: string;
  /** Max-width constraint for the content area. Defaults to `max-w-content`. Set `false` to disable. */
  maxWidth?: string | false;
};

const PageShell: Component<PageShellProps> = (props) => {
  const maxWidthClass = () => {
    if (props.maxWidth === false) return '';
    return props.maxWidth ?? 'max-w-content';
  };

  return (
    <div class="h-screen flex overflow-hidden">
      <Sidebar />
      <div class="flex flex-col flex-1 overflow-hidden">
        <MobileNav />
        <main
          id="main-content"
          class="flex-1 overflow-y-auto pb-mobile-nav"
        >
          <div
            class={cn(
              'mx-auto p-4 md:p-6',
              maxWidthClass(),
              props.class,
            )}
          >
            {props.children}
          </div>
        </main>
      </div>
    </div>
  );
};

export default PageShell;
