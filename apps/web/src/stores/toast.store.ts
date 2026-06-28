import { createSignal, type JSX } from 'solid-js';
import { toast as sonnerToast, type ExternalToast } from 'solid-sonner';

export type ToastType = 'success' | 'error' | 'info' | 'warning';
export type ToastMessage = string | JSX.Element | (() => JSX.Element);

export interface Toast {
  id: string | number;
  message: ToastMessage;
  type: ToastType;
}

const DEFAULT_DURATION = 3000;
const [toasts, setToasts] = createSignal<Toast[]>([]);
const toastTimeouts = new Map<string | number, ReturnType<typeof setTimeout>>();

export { toasts };

function scheduleToastRemoval(id: string | number, duration?: number) {
  const existingTimeout = toastTimeouts.get(id);

  if (existingTimeout) {
    clearTimeout(existingTimeout);
    toastTimeouts.delete(id);
  }

  if (duration === Infinity) return;

  const timeout = setTimeout(() => removeToast(id), duration ?? DEFAULT_DURATION);
  toastTimeouts.set(id, timeout);
}

function syncLegacyToast(
  id: string | number,
  message: ToastMessage,
  type: ToastType,
  data?: ExternalToast,
) {
  setToasts((currentToasts) => {
    const nextToast = { id, message, type };
    const existingIndex = currentToasts.findIndex((toast) => toast.id === id);

    if (existingIndex === -1) {
      return [...currentToasts, nextToast];
    }

    const nextToasts = currentToasts.slice();
    nextToasts[existingIndex] = nextToast;
    return nextToasts;
  });

  scheduleToastRemoval(id, data?.duration);
}

function notifyToast(
  type: ToastType,
  message: ToastMessage,
  data?: ExternalToast,
) {
  const id = sonnerToast[type](message, data);
  syncLegacyToast(id, message, type, data);
  return id;
}

export function addToast(
  message: ToastMessage,
  type: ToastType = 'success',
  data?: ExternalToast,
) {
  return notifyToast(type, message, data);
}

export function removeToast(id: string | number) {
  const timeout = toastTimeouts.get(id);

  if (timeout) {
    clearTimeout(timeout);
    toastTimeouts.delete(id);
  }

  sonnerToast.dismiss(id);
  setToasts((currentToasts) =>
    currentToasts.filter((toast) => toast.id !== id),
  );
}

export const toast = {
  success: (message: ToastMessage, data?: ExternalToast) =>
    notifyToast('success', message, data),
  error: (message: ToastMessage, data?: ExternalToast) =>
    notifyToast('error', message, data),
  info: (message: ToastMessage, data?: ExternalToast) =>
    notifyToast('info', message, data),
  warning: (message: ToastMessage, data?: ExternalToast) =>
    notifyToast('warning', message, data),
};
