import {
  type Component,
  Show,
  createMemo,
  createSignal,
  onMount,
} from 'solid-js';
import { A, useSearchParams } from '@solidjs/router';
import { api, getApiError } from '@/api/client';
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
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
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Verification failed');
      setStatus('error');
    }
  });

  return (
    <div class="min-h-screen flex items-center justify-center px-4">
      <Card class="w-full max-w-sm">
        <CardHeader class="text-center items-center">
          <img
            src="/logo-engram-full.webp"
            alt="Engram Spira"
            class="h-20 w-auto mb-2"
          />
          <CardTitle>Email Verification</CardTitle>
        </CardHeader>

        <CardContent class="text-center space-y-4">
          <Show when={status() === 'loading'}>
            <div class="flex flex-col items-center gap-3 py-4">
              <Spinner size="lg" />
              <p class="text-sm text-muted-foreground">
                Verifying your email...
              </p>
            </div>
          </Show>

          <Show when={status() === 'success'}>
            <div class="flex flex-col items-center gap-3 py-4">
              <div class="h-14 w-14 rounded-full bg-green-500/15 flex items-center justify-center">
                <CheckCircle2 class="h-8 w-8 text-green-500" />
              </div>
              <div>
                <p class="font-semibold text-foreground">Email Verified!</p>
                <p class="text-sm text-muted-foreground mt-1">
                  Your email has been successfully verified.
                </p>
              </div>
            </div>
          </Show>

          <Show when={status() === 'already'}>
            <div class="flex flex-col items-center gap-3 py-4">
              <div class="h-14 w-14 rounded-full bg-blue-500/15 flex items-center justify-center">
                <CheckCircle2 class="h-8 w-8 text-blue-500" />
              </div>
              <div>
                <p class="font-semibold text-foreground">Already Verified</p>
                <p class="text-sm text-muted-foreground mt-1">
                  Your email was already verified. You're all set!
                </p>
              </div>
            </div>
          </Show>

          <Show when={status() === 'error'}>
            <div class="flex flex-col items-center gap-3 py-4">
              <div class="h-14 w-14 rounded-full bg-destructive/15 flex items-center justify-center">
                <XCircle class="h-8 w-8 text-destructive" />
              </div>
              <div>
                <p class="font-semibold text-foreground">Verification Failed</p>
                <p class="text-sm text-muted-foreground mt-1">
                  {errorMsg() ||
                    'The verification link is invalid or has expired.'}
                </p>
              </div>
            </div>
          </Show>

          <Show when={status() === 'no-token'}>
            <div class="flex flex-col items-center gap-3 py-4">
              <div class="h-14 w-14 rounded-full bg-muted flex items-center justify-center">
                <MailOpen class="h-8 w-8 text-muted-foreground" />
              </div>
              <div>
                <p class="font-semibold text-foreground">
                  No Verification Token
                </p>
                <p class="text-sm text-muted-foreground mt-1">
                  Please use the link sent to your email.
                </p>
              </div>
            </div>
          </Show>
        </CardContent>

        <CardFooter class="justify-center">
          <A href="/">
            <Button variant="outline">Go to Dashboard</Button>
          </A>
        </CardFooter>
      </Card>
    </div>
  );
};

export default VerifyEmailPage;
