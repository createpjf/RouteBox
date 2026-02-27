import { useState, useEffect, useRef, useCallback } from "react";
import { RouteBoxWebSocket } from "@/lib/ws";
import { getWsUrl } from "@/lib/constants";
import type { RealtimeStats, TrafficPoint, RequestLogEntry } from "@/types/stats";

const MAX_HISTORY = 30;
const MAX_LOG_ENTRIES = 100;
const CACHE_KEY = "cachedStats";

export interface AlertInfo {
  id: string;
  title: string;
  message: string;
}

// ── Offline cache helpers ────────────────────────────────────────────────────

async function loadCachedStats(): Promise<RealtimeStats | null> {
  try {
    const { load } = await import("@tauri-apps/plugin-store");
    const store = await load("settings.json", { defaults: {} });
    return await store.get<RealtimeStats>(CACHE_KEY);
  } catch {
    return null;
  }
}

async function saveCachedStats(stats: RealtimeStats) {
  try {
    const { load } = await import("@tauri-apps/plugin-store");
    const store = await load("settings.json", { defaults: {} });
    await store.set(CACHE_KEY, stats);
  } catch {
    // ignore
  }
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useRealtimeStats() {
  const [stats, setStats] = useState<RealtimeStats | null>(null);
  const [connected, setConnected] = useState(false);
  const [stale, setStale] = useState(false);
  const [history, setHistory] = useState<TrafficPoint[]>([]);
  const [requestLog, setRequestLog] = useState<RequestLogEntry[]>([]);
  const [alert, setAlert] = useState<AlertInfo | null>(null);
  const wsRef = useRef<RouteBoxWebSocket | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load cached stats as initial state
  useEffect(() => {
    loadCachedStats().then((cached) => {
      if (cached && !wsRef.current) {
        setStats(cached);
        setStale(true);
      }
    });
  }, []);

  useEffect(() => {
    const ws = new RouteBoxWebSocket(getWsUrl());
    wsRef.current = ws;

    ws.on("open", () => {
      setConnected(true);
      setStale(false);
    });
    ws.on("close", () => setConnected(false));

    ws.on("stats", (data) => {
      const s = data as RealtimeStats;
      setStats(s);
      setStale(false);

      // Debounced cache save (at most every 5s)
      if (!saveTimerRef.current) {
        saveTimerRef.current = setTimeout(() => {
          saveTimerRef.current = null;
          saveCachedStats(s);
        }, 5000);
      }

      setHistory((prev) => {
        const point: TrafficPoint = {
          time: new Date().toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          }),
          value: s.requests,
        };
        const next = [...prev, point];
        return next.length > MAX_HISTORY ? next.slice(-MAX_HISTORY) : next;
      });
    });

    ws.on("request_log", (data) => {
      const entry = data as RequestLogEntry;
      setRequestLog((prev) => {
        const next = [...prev, entry];
        return next.length > MAX_LOG_ENTRIES ? next.slice(-MAX_LOG_ENTRIES) : next;
      });
    });

    ws.on("alert", async (data) => {
      const a = data as { title: string; message: string };
      setAlert({ id: `alert_${Date.now()}`, ...a });
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("show_notification", {
          title: a.title,
          body: a.message,
        });
      } catch {
        // Browser fallback: no-op
      }
    });

    ws.connect();

    return () => {
      ws.disconnect();
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  const disconnect = useCallback(() => {
    wsRef.current?.disconnect();
  }, []);

  const dismissAlert = useCallback(() => {
    setAlert(null);
  }, []);

  return { stats, connected, stale, history, requestLog, alert, dismissAlert, disconnect };
}
