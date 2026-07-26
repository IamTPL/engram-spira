import {
  type Component,
  type JSX,
  Show,
  createMemo,
  createSignal,
  onMount,
} from 'solid-js';
import { A, useSearchParams } from '@solidjs/router';
import { api, getApiError } from '@/api/client';
import { fetchCurrentUser } from '@/stores/auth.store';
import AuthFrame from '@/components/auth/auth-frame';
import { buttonVariants } from '@/components/ui/button';
import Spinner from '@/components/ui/spinner';
import { CheckCircle2, XCircle, MailOpen } from 'lucide-solid';

const VerifyEmailPage: Component = () => {
  const [searchParams] = useSearchParams();

  const token = createMemo(() => {
    const raw = searchParams.token;
    if (Array.isArray(raw)) return (raw[0] ?? '').trim();
    return (raw ?? '').trim();
  });

  const [status, setStatus] = createSignal<
    'loading' | 'success' | 'already' | 'error' | 'no-token'
  >('loading');
  const [errorMsg, setErrorMsg] = createSignal('');

  onMount(async () => {
    if (!token()) {
      setStatus('no-token');
      return;
    }

    try {
      const { data, error } = await (api.auth as any)['verify-email'].get({
        query: { token: token() },
      });
      if (error) throw new Error(getApiError(error));
      if (data?.alreadyVerified) {
        setStatus('already');
      } else {
        setStatus('success');
      }
      // Refresh currentUser signal so dashboard banner reflects verified state
      await fetchCurrentUser();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Verification failed');
      setStatus('error');
    }
  });

  return (
    <AuthFrame
      title="Email verification"
      description="Confirming your email keeps your learning workspace secure."
    >
      <div class="space-y-6">
        <Show when={status() === 'loading'}>
          <VerificationState
            icon={<Spinner size="lg" />}
            title="Verifying your email"
            description="This should only take a moment."
          />
        </Show>

        <Show when={status() === 'success'}>
          <VerificationState
            icon={
              <CheckCircle2 class="h-7 w-7 text-success" aria-hidden="true" />
            }
            title="Email verified"
            description="Your email has been successfully verified."
            tone="success"
          />
        </Show>

        <Show when={status() === 'already'}>
          <VerificationState
            icon={<CheckCircle2 class="h-7 w-7 text-info" aria-hidden="true" />}
            title="Already verified"
            description="Your email was already verified. You are all set."
            tone="info"
          />
        </Show>

        <Show when={status() === 'error'}>
          <VerificationState
            icon={<XCircle class="h-7 w-7 text-destructive" aria-hidden="true" />}
            title="Verification failed"
            description={
              errorMsg() || 'The verification link is invalid or has expired.'
            }
            tone="destructive"
          />
        </Show>

        <Show when={status() === 'no-token'}>
          <VerificationState
            icon={
              <MailOpen
                class="h-7 w-7 text-muted-foreground"
                aria-hidden="true"
              />
            }
            title="Verification link required"
            description="Please use the link sent to your email."
          />
        </Show>

        <A
          href="/"
          class={`${buttonVariants({ variant: 'default' })} w-full no-underline hover:no-underline`}
        >
          Go to dashboard
        </A>
      </div>
    </AuthFrame>
  );
};

const VerificationState: Component<{
  icon: JSX.Element;
  title: string;
  description: string;
  tone?: 'success' | 'info' | 'destructive';
}> = (props) => {
  const toneClass = () => {
    if (props.tone === 'success') return 'border-success/25 bg-success/10';
    if (props.tone === 'info') return 'border-info/25 bg-info/10';
    if (props.tone === 'destructive')
      return 'border-destructive/25 bg-destructive/10';
    return 'border-border bg-muted/40';
  };

  return (
    <div
      class={`rounded-xl border p-6 text-center ${toneClass()}`}
      role={props.tone === 'destructive' ? 'alert' : 'status'}
    >
      <div class="mx-auto flex h-12 w-12 items-center justify-center rounded-xl border bg-background shadow-xs">
        {props.icon}
      </div>
      <p class="mt-4 font-semibold text-foreground">{props.title}</p>
      <p class="mt-1 text-sm leading-6 text-muted-foreground">
        {props.description}
      </p>
    </div>
  );
};

export default VerifyEmailPage;
