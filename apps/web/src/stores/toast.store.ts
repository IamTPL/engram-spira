import { createSignal } from 'solid-js';

export type ToastType = 'success' | 'error' | 'info';

export interface Toast {
  id: string;
  message: string;
  type: ToastType;
}

const [toasts, setToasts] = createSignal<Toast[]>([]);

export { toasts };

export function addToast(message: string, type: ToastType = 'success') {
  const id = crypto.randomUUID();
  setToasts((prev) => [...prev, { id, message, type }]);
  setTimeout(() => removeToast(id), 3000);
}

export function removeToast(id: string) {
  setToasts((prev) => prev.filter((t) => t.id !== id));
}

export const toast = {
  success: (message: string) => addToast(message, 'success'),
  error: (message: string) => addToast(message, 'error'),
  info: (message: string) => addToast(message, 'info'),
};
