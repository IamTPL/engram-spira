import { type Component, Suspense, lazy } from 'solid-js';

const GlobalSearch = lazy(() => import('@/components/search/global-search'));

export const CommandSearch: Component = () => {
  return (
    <Suspense>
      <GlobalSearch />
    </Suspense>
  );
};
