import { createContext, useCallback, useContext, useMemo, useState } from 'react';

interface Toast {
  id: number;
  message: string;
}

interface ToastContextValue {
  notify: (message: string) => void;
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
    (message: string) => {
      const id = nextId++;
      setToasts((current) => [...current.slice(-2), { id, message }]);
      window.setTimeout(() => dismiss(id), 3200);
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
