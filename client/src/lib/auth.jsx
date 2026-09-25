import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from './api.js';
import { hasRole } from '../../../shared/roles.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [state, setState] = useState({ loading: true, user: null, providers: {}, env: null });

  const refresh = useCallback(async () => {
    try {
      const { user, providers, env } = await api('/api/me');
      setState({ loading: false, user, providers, env });
    } catch {
      setState({ loading: false, user: null, providers: {}, env: null });
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const logout = useCallback(async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    setState((s) => ({ ...s, user: null }));
  }, []);

  const can = useCallback((role) => hasRole(state.user?.role, role), [state.user]);

  return <AuthContext.Provider value={{ ...state, refresh, logout, can }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
