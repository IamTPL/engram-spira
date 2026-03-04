import { createSignal } from 'solid-js';
import { api } from '../api/client';

export interface User {
  id: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
}

const [currentUser, setCurrentUser] = createSignal<User | null>(null);
const [isLoading, setIsLoading] = createSignal(true);

export { currentUser, isLoading };

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
  if (error)
    throw new Error(
      typeof error === 'object' && 'error' in error
        ? (error as any).error
        : 'Login failed',
    );
  if (data?.user) setCurrentUser(data.user as User);
  return data;
}

export async function register(email: string, password: string) {
  const { data, error } = await api.auth.register.post({ email, password });
  if (error)
    throw new Error(
      typeof error === 'object' && 'error' in error
        ? (error as any).error
        : 'Registration failed',
    );
  if (data?.user) setCurrentUser(data.user as User);
  return data;
}

export async function logout() {
  await api.auth.logout.post();
  setCurrentUser(null);
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
  if (error)
    throw new Error(
      typeof error === 'object' && 'error' in error
        ? (error as any).error
        : 'Failed to update profile',
    );
  if (result?.user) {
    setCurrentUser((prev) => (prev ? { ...prev, ...result.user } : null));
  }
  return result;
}
