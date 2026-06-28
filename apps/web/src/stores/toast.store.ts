import { type JSX } from 'solid-js';
import { toast as sonnerToast, type ExternalToast } from 'solid-sonner';

export type ToastType = 'success' | 'error' | 'info' | 'warning';
export type ToastMessage = string | JSX.Element | (() => JSX.Element);

export interface Toast {
  id: string | number;
  message: ToastMessage;
  type: ToastType;
}

export const toasts = () =>
  sonnerToast.getToasts().map((toast) => ({
    id: toast.id,
    message: toast.title ?? '',
    type: normalizeToastType(toast.type),
  }));

function normalizeToastType(type: string | undefined): ToastType {
  if (type === 'error') return 'error';
  if (type === 'info') return 'info';
  if (type === 'warning') return 'warning';
  return 'success';
}

export function addToast(
  message: ToastMessage,
  type: ToastType = 'success',
  data?: ExternalToast,
) {
  return toast[type](message, data);
}

export function removeToast(id: string | number) {
  sonnerToast.dismiss(id);
}

export const toast = {
  success: (message: ToastMessage, data?: ExternalToast) =>
    sonnerToast.success(message, data),
  error: (message: ToastMessage, data?: ExternalToast) =>
    sonnerToast.error(message, data),
  info: (message: ToastMessage, data?: ExternalToast) =>
    sonnerToast.info(message, data),
  warning: (message: ToastMessage, data?: ExternalToast) =>
    sonnerToast.warning(message, data),
};
