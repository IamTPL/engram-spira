import { type Component, Show, createMemo, createSignal } from 'solid-js';
import { A, useNavigate, useSearchParams } from '@solidjs/router';
import { api, getApiError } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

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
      setTimeout(() => navigate('/login', { replace: true }), 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reset password');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div class="min-h-screen flex items-center justify-center px-4">
      <Card class="w-full max-w-sm">
        <CardHeader class="text-center items-center">
          <img
            src="/logo-engram-full.webp"
            alt="Engram Spira"
            class="h-20 w-auto mb-2"
          />
          <CardTitle>
            {hasToken() ? 'Set New Password' : 'Forgot Password'}
          </CardTitle>
          <CardDescription>
            {hasToken()
              ? 'Enter your new password to finish resetting your account.'
              : 'Enter your email to receive a password reset link.'}
          </CardDescription>
        </CardHeader>

        <Show
          when={hasToken()}
          fallback={
            <form onSubmit={handleRequestReset}>
              <CardContent class="space-y-4">
                <Show when={error()}>
                  <div
                    role="alert"
                    class="text-sm text-destructive text-center"
                  >
                    {error()}
                  </div>
                </Show>
                <Show when={success()}>
                  <div role="status" class="text-sm text-green-600 text-center">
                    {success()}
                  </div>
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
                  />
                </div>
              </CardContent>
              <CardFooter class="flex-col gap-2">
                <Button type="submit" class="w-full" disabled={loading()}>
                  {loading() ? 'Sending...' : 'Send Reset Link'}
                </Button>
                <p class="text-sm text-muted-foreground">
                  Back to{' '}
                  <A href="/login" class="text-palette-5 underline">
                    Sign in
                  </A>
                </p>
              </CardFooter>
            </form>
          }
        >
          <form onSubmit={handleResetPassword}>
            <CardContent class="space-y-4">
              <Show when={error()}>
                <div role="alert" class="text-sm text-destructive text-center">
                  {error()}
                </div>
              </Show>
              <Show when={success()}>
                <div role="status" class="text-sm text-green-600 text-center">
                  {success()}
                </div>
              </Show>
              <div class="space-y-2">
                <label class="text-sm font-medium" for="new-password">
                  New Password
                </label>
                <Input
                  id="new-password"
                  type="password"
                  autocomplete="new-password"
                  placeholder="At least 8 characters"
                  value={newPassword()}
                  onInput={(e) => setNewPassword(e.currentTarget.value)}
                  required
                />
              </div>
              <div class="space-y-2">
                <label class="text-sm font-medium" for="confirm-password">
                  Confirm Password
                </label>
                <Input
                  id="confirm-password"
                  type="password"
                  autocomplete="new-password"
                  placeholder="Re-enter password"
                  value={confirmPassword()}
                  onInput={(e) => setConfirmPassword(e.currentTarget.value)}
                  required
                />
              </div>
            </CardContent>
            <CardFooter class="flex-col gap-2">
              <Button type="submit" class="w-full" disabled={loading()}>
                {loading() ? 'Updating...' : 'Reset Password'}
              </Button>
              <p class="text-sm text-muted-foreground">
                Back to{' '}
                <A href="/login" class="text-palette-5 underline">
                  Sign in
                </A>
              </p>
            </CardFooter>
          </form>
        </Show>
      </Card>
    </div>
  );
};

export default ResetPasswordPage;
