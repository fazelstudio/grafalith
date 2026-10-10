// Full notification surface for the shell toast region.
//
// Extensions and core UI share this provider: leveled toasts with actions,
// per-toast lifetime, source attribution, and a dismiss-all command wired
// to `grafalith.view.notification.dismissAll`.
import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { DESKTOP_TIMING } from '../theme/tokens';

export type ToastLevel = 'info' | 'success' | 'warning' | 'error';

export interface ToastAction {
  label: string;
  commandId: string;
}

export interface Toast {
  id: number;
  message: string;
  level: ToastLevel;
  action?: ToastAction;
  actions?: readonly ToastAction[];
  source?: string;
}

export interface NotifyOptions {
  level?: ToastLevel;
  action?: ToastAction;
  actions?: readonly ToastAction[];
  /** Lifetime in ms; 0 means persistent until dismissed. */
  duration?: number;
  /** Extension attribution (`publisher.id`) or core surface name. */
  source?: string;
}

interface ToastContextValue {
  notify: (message: string, options?: NotifyOptions) => void;
  toasts: readonly Toast[];
  dismiss: (id: number) => void;
  dismissAll: () => void;
}

const ToastContext = createContext<ToastContextValue>({
  notify: () => undefined,
  toasts: [],
  dismiss: () => undefined,
  dismissAll: () => undefined,
});

let nextId = 1;

/** Non-blocking notification state shared by the shell toast region. */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<readonly Toast[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const dismissAll = useCallback(() => {
    setToasts([]);
  }, []);

  const notify = useCallback(
    (message: string, options?: NotifyOptions) => {
      const id = nextId++;
      const level = options?.level ?? 'info';
      const action = options?.action ?? options?.actions?.[0];
      const actions = options?.actions;
      const source = options?.source;
      setToasts((current) => [...current.slice(-2), { id, message, level, action, actions, source }]);
      const duration = options?.duration ?? DESKTOP_TIMING.toastDurationMs;
      if (duration > 0) window.setTimeout(() => dismiss(id), duration);
    },
    [dismiss],
  );

  const value = useMemo(() => ({ notify, toasts, dismiss, dismissAll }), [notify, toasts, dismiss, dismissAll]);
  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>;
}

/** Push a transient message into the shell toast region. */
export function useToast(): ToastContextValue {
  return useContext(ToastContext);
}
