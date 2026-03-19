import { createSignal } from 'solid-js';
import { api, getApiError } from '../api/client';
import { queryClient } from '../lib/query-client';

export interface User {
  id: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
  emailVerified: boolean;
}

const [currentUser, setCurrentUser] = createSignal<User | null>(null);
const [isLoading, setIsLoading] = createSignal(true);

export { currentUser, isLoading };

async function getTreatyErrorMessage(error: unknown): Promise<string> {
  if (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    error.status === 401
  ) {
    const directMessage = getApiError(error);
    if (directMessage !== 'An unknown error occurred') return directMessage;
    return 'Invalid email or password';
  }

  const fallback = getApiError(error);
  if (fallback !== 'An unknown error occurred') return fallback;

  if (
    typeof error === 'object' &&
    error !== null &&
    'response' in error &&
    error.response instanceof Response
  ) {
    try {
      const payload = await error.response.clone().json();
      const message = getApiError(payload);
      if (message !== 'An unknown error occurred') return message;
    } catch {
      try {
        const text = await error.response.clone().text();
        if (text) return text;
      } catch {}
    }
  }

  return fallback;
}

export async function fetchCurrentUser() {
  setIsLoading(true);
  try {
    const { data, error } = await api.auth.me.get();
    if (data?.user) {
      setCurrentUser(data.user as User);
    } else {
      setCurrentUser(null);
    }
  } catch {
    setCurrentUser(null);
  } finally {
    setIsLoading(false);
  }
}

export async function login(email: string, password: string) {
  const { data, error } = await api.auth.login.post({ email, password });
  if (error) throw new Error(await getTreatyErrorMessage(error));
  if (data?.user) setCurrentUser(data.user as User);
  return data;
}

export async function register(email: string, password: string) {
  const { data, error } = await api.auth.register.post({ email, password });
  if (error) throw new Error(await getTreatyErrorMessage(error));
  if (data?.user) setCurrentUser(data.user as User);
  return data;
}

export async function logout() {
  await api.auth.logout.post();
  setCurrentUser(null);
  queryClient.clear();
}

/**
 * Updates the user profile: display name and/or avatar URL.
 * Calls PATCH /users/profile, then merges the result into the currentUser signal.
 */
export async function updateProfile(data: {
  displayName?: string;
  avatarUrl?: string;
}) {
  // Using `as any` because Eden Treaty requires a rebuild to pick up newly registered routes
  const { data: result, error } = await (api as any).users.profile.patch(data);
  if (error) throw new Error(await getTreatyErrorMessage(error));
  if (result?.user) {
    setCurrentUser((prev) => (prev ? { ...prev, ...result.user } : null));
  }
  return result;
}
