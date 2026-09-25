import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';

/**
 * Load JSON from `path` (re-fetched when it changes). Returns
 * { data, error, loading, reload }. Pass null to skip loading.
 */
export function useLoad(path) {
  const [state, setState] = useState({ data: null, error: null, loading: Boolean(path) });

  const reload = useCallback(async () => {
    if (!path) return;
    try {
      const data = await api(path);
      setState({ data, error: null, loading: false });
    } catch (error) {
      setState((s) => ({ ...s, error, loading: false }));
    }
  }, [path]);

  useEffect(() => {
    setState((s) => ({ ...s, loading: true }));
    reload();
  }, [reload]);

  return { ...state, reload };
}
