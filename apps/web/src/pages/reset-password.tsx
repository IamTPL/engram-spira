import {
  type Component,
  Show,
  createMemo,
  createSignal,
  onCleanup,
} from 'solid-js';
import { A, useNavigate, useSearchParams } from '@solidjs/router';
import { api, getApiError } from '@/api/client';
import AuthFrame from '@/components/auth/auth-frame';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Lock, Mail, ShieldCheck } from 'lucide-solid';

const ResetPasswordPage: Component = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const token = createMemo(() => {
    const raw = searchParams.token;
    if (Array.isArray(raw)) return (raw[0] ?? '').trim();
    return (raw ?? '').trim();
  });
  const hasToken = createMemo(() => token().length > 0);

  const [email, setEmail] = createSignal('');
  const [newPassword, setNewPassword] = createSignal('');
  const [confirmPassword, setConfirmPassword] = createSignal('');
  const [error, setError] = createSignal('');
  const [success, setSuccess] = createSignal('');
  const [loading, setLoading] = createSignal(false);
  let redirectTimer: ReturnType<typeof setTimeout> | undefined;

  onCleanup(() => {
    if (redirectTimer) clearTimeout(redirectTimer);
  });

  const handleRequestReset = async (e: Event) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);
    try {
      const { error: apiError } = await api.auth['forgot-password'].post({
        email: email().trim(),
      });
      if (apiError) throw new Error(getApiError(apiError));
      setSuccess('If this email exists, a reset link has been sent.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to request reset');
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (e: Event) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (newPassword().length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (newPassword() !== confirmPassword()) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      const { error: apiError } = await api.auth['reset-password'].post({
        token: token(),
        newPassword: newPassword(),
      });
      if (apiError) throw new Error(getApiError(apiError));
      setSuccess(
        'Password has been reset successfully. Redirecting to login...',
      );
      redirectTimer = setTimeout(
        () => navigate('/login', { replace: true }),
        1200,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reset password');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthFrame
      title={hasToken() ? 'Set a new password' : 'Reset your password'}
      description={
        hasToken()
          ? 'Choose a new password to finish recovering your account.'
          : 'Enter your email and we will send a secure reset link.'
      }
    >
      <Show
        when={hasToken()}
        fallback={
          <form onSubmit={handleRequestReset} class="space-y-5">
            <Show when={error()}>
              <Alert variant="destructive">{error()}</Alert>
            </Show>
            <Show when={success()}>
              <Alert variant="success">{success()}</Alert>
            </Show>

            <div class="space-y-2">
              <label class="text-sm font-medium" for="email">
                Email
              </label>
              <Input
                id="email"
                type="email"
                autocomplete="email"
                placeholder="you@example.com"
                value={email()}
                onInput={(e) => setEmail(e.currentTarget.value)}
                required
                iconLeft={<Mail class="h-4 w-4" />}
              />
            </div>

            <Button type="submit" class="w-full" loading={loading()}>
              Send reset link
            </Button>
            <p class="text-center text-sm text-muted-foreground">
              Remembered it?{' '}
              <A href="/login" class="font-medium text-foreground hover:underline">
                Sign in
              </A>
            </p>
          </form>
        }
      >
        <form onSubmit={handleResetPassword} class="space-y-5">
          <Show when={error()}>
            <Alert variant="destructive">{error()}</Alert>
          </Show>
          <Show when={success()}>
            <Alert variant="success">{success()}</Alert>
          </Show>

          <div class="space-y-2">
            <label class="text-sm font-medium" for="new-password">
              New password
            </label>
            <Input
              id="new-password"
              type="password"
              autocomplete="new-password"
              placeholder="At least 8 characters"
              value={newPassword()}
              onInput={(e) => setNewPassword(e.currentTarget.value)}
              required
              iconLeft={<Lock class="h-4 w-4" />}
            />
          </div>

          <div class="space-y-2">
            <label class="text-sm font-medium" for="confirm-password">
              Confirm password
            </label>
            <Input
              id="confirm-password"
              type="password"
              autocomplete="new-password"
              placeholder="Re-enter password"
              value={confirmPassword()}
              onInput={(e) => setConfirmPassword(e.currentTarget.value)}
              required
              iconLeft={<ShieldCheck class="h-4 w-4" />}
            />
          </div>

          <Button type="submit" class="w-full" loading={loading()}>
            Reset password
          </Button>
          <p class="text-center text-sm text-muted-foreground">
            Back to{' '}
            <A href="/login" class="font-medium text-foreground hover:underline">
              Sign in
            </A>
          </p>
        </form>
      </Show>
    </AuthFrame>
  );
};

export default ResetPasswordPage;
