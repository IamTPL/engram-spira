import { type Component, type JSX, Show } from 'solid-js';
import { A } from '@solidjs/router';

type AuthFrameProps = {
  title: JSX.Element;
  description?: JSX.Element;
  children: JSX.Element;
};

const AuthFrame: Component<AuthFrameProps> = (props) => {
  return (
    <main class="grid min-h-[100dvh] overflow-x-hidden bg-background lg:grid-cols-[minmax(320px,0.9fr)_minmax(520px,1.1fr)]">
      <aside class="relative hidden overflow-hidden border-r bg-muted/45 p-10 lg:flex lg:flex-col xl:p-14">
        <A
          href="/"
          class="inline-flex w-fit items-center gap-3 text-foreground no-underline hover:no-underline"
          aria-label="Engram Spira home"
        >
          <span class="flex h-11 w-11 items-center justify-center rounded-xl border bg-card shadow-xs">
            <img
              src="/logo-engram.webp"
              alt=""
              aria-hidden="true"
              class="h-7 w-auto rounded-sm"
            />
          </span>
          <span class="text-base font-semibold tracking-tight">Engram Spira</span>
        </A>

        <div class="my-auto max-w-md py-12">
          <p class="text-4xl font-semibold leading-[1.08] tracking-[-0.04em] text-foreground xl:text-5xl">
            Learn deliberately. Remember longer.
          </p>
          <p class="mt-5 max-w-sm text-base leading-7 text-muted-foreground">
            Turn active recall into a focused daily practice with adaptive review.
          </p>
        </div>

        <p class="max-w-sm text-xs leading-5 text-muted-foreground">
          A calm workspace for your notes, reviews, and focus sessions.
        </p>
      </aside>

      <section class="flex min-h-[100dvh] min-w-0 items-center justify-center px-5 py-10 sm:px-8 lg:px-12">
        <div class="min-w-0 w-full max-w-[420px] motion-safe:animate-fade-in">
          <A
            href="/"
            class="mb-10 inline-flex items-center gap-2.5 text-foreground no-underline hover:no-underline lg:hidden"
            aria-label="Engram Spira home"
          >
            <span class="flex h-10 w-10 items-center justify-center rounded-xl border bg-card shadow-xs">
              <img
                src="/logo-engram.webp"
                alt=""
                aria-hidden="true"
                class="h-6 w-auto rounded-sm"
              />
            </span>
            <span class="text-sm font-semibold tracking-tight">Engram Spira</span>
          </A>

          <header class="mb-8">
            <h1 class="text-3xl font-semibold tracking-[-0.035em] text-foreground">
              {props.title}
            </h1>
            <Show when={props.description}>
              <p class="mt-2 max-w-sm break-words text-sm leading-6 text-muted-foreground">
                {props.description}
              </p>
            </Show>
          </header>

          {props.children}
        </div>
      </section>
    </main>
  );
};

export default AuthFrame;
