import { useState, useEffect, useCallback } from "react";
import { getToken, setToken, clearToken, getStoredUser, setStoredUser, type User } from "@/lib/auth";
import * as api from "@/lib/api";

export function useAuth() {
  const [user, setUser] = useState<User | null>(getStoredUser);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const authenticated = !!getToken();

  useEffect(() => {
    if (authenticated && !user) {
      api.getAccountInfo().then((info) => {
        const u: User = {
          id: info.id,
          email: info.email,
          displayName: info.displayName,
          plan: info.plan,
        };
        setUser(u);
        setStoredUser(u);
      }).catch(() => {
        clearToken();
        setUser(null);
      });
    }
  }, [authenticated, user]);

  const login = useCallback(async (email: string, password: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.login(email, password);
      setToken(res.token);
      const u: User = {
        id: res.user.id,
        email: res.user.email,
        displayName: res.user.displayName,
        plan: res.user.plan,
      };
      setUser(u);
      setStoredUser(u);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const signup = useCallback(async (email: string, password: string, displayName: string, referralCode?: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.register(email, password, displayName, referralCode);
      setToken(res.token);
      const u: User = {
        id: res.user.id,
        email: res.user.email,
        displayName: res.user.displayName,
        plan: res.user.plan,
      };
      setUser(u);
      setStoredUser(u);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed");
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(() => {
    clearToken();
    setUser(null);
    window.location.href = "/login";
  }, []);

  return { user, authenticated, loading, error, login, signup, logout, setError };
}
