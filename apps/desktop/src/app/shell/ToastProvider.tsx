import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { DESKTOP_TIMING } from '../theme/tokens';

interface ToastAction {
  label: string;
  commandId: string;
}

interface Toast {
  id: number;
  message: string;
  level: 'info' | 'success' | 'error';
  action?: ToastAction;
}

interface NotifyOptions {
  level?: Toast['level'];
  action?: ToastAction;
}

interface ToastContextValue {
  notify: (message: string, options?: NotifyOptions) => void;
  toasts: readonly Toast[];
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastContextValue>({
  notify: () => undefined,
  toasts: [],
  dismiss: () => undefined,
});

let nextId = 1;

/** Non-blocking notification state shared by the shell toast region. */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<readonly Toast[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const notify = useCallback(
    (message: string, options?: NotifyOptions) => {
      const id = nextId++;
      const level = options?.level ?? 'info';
      const action = options?.action;
      setToasts((current) => [...current.slice(-2), { id, message, level, action }]);
      window.setTimeout(() => dismiss(id), DESKTOP_TIMING.toastDurationMs);
    },
    [dismiss],
  );

  const value = useMemo(() => ({ notify, toasts, dismiss }), [notify, toasts, dismiss]);
  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>;
}

/** Push a transient message into the shell toast region. */
export function useToast(): ToastContextValue {
  return useContext(ToastContext);
}
