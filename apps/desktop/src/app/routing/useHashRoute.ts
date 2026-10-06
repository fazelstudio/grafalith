import { useCallback, useEffect, useState } from 'react';
import { routeRegistry, type RouteDefinition } from './routes';

function readHash(): string {
  if (typeof window === 'undefined') return '#/';
  const hash = window.location.hash;
  return hash === '' ? '#/' : hash;
}

/** Minimal hash router; the route registry stays the source of path truth. */
export function useHashRoute(): {
  route: RouteDefinition;
  hash: string;
  navigate: (path: string) => void;
} {
  const [hash, setHash] = useState<string>(() => readHash());

  useEffect(() => {
    function onChange() {
      setHash(readHash());
    }
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  const navigate = useCallback((path: string) => {
    if (window.location.hash === path) {
      setHash(path);
      return;
    }
    window.location.hash = path;
  }, []);

  return { route: routeRegistry.fromPath(hash), hash, navigate };
}
