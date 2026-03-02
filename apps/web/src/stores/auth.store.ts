import { createSignal } from 'solid-js';
import { api } from '../api/client';

interface User {
  id: string;
  email: string;
}

const [currentUser, setCurrentUser] = createSignal<User | null>(null);
const [isLoading, setIsLoading] = createSignal(true);

export { currentUser, isLoading };

export async function fetchCurrentUser() {
  setIsLoading(true);
  try {
    const { data, error } = await api.auth.me.get();
    if (data?.user) {
      setCurrentUser(data.user);
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
  if (data?.user) setCurrentUser(data.user);
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
  if (data?.user) setCurrentUser(data.user);
  return data;
}

export async function logout() {
  await api.auth.logout.post();
  setCurrentUser(null);
}
