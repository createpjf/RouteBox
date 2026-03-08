import { useState, useEffect, useRef, useCallback } from "react";
import { RouteBoxWebSocket } from "@/lib/ws";
import { getWsUrl, getGatewayMode } from "@/lib/constants";
import { api } from "@/lib/api";
import type { RealtimeStats, TrafficPoint, RequestLogEntry } from "@/types/stats";

const MAX_HISTORY = 30;
const MAX_LOG_ENTRIES = 100;
const CACHE_KEY = "cachedStats";
const CLOUD_POLL_INTERVAL = 3000;

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
    return await store.get<RealtimeStats>(CACHE_KEY) ?? null;
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

export function useRealtimeStats(ready = true) {
  const [stats, setStats] = useState<RealtimeStats | null>(null);
  const [connected, setConnected] = useState(false);
  const [stale, setStale] = useState(false);
  const [history, setHistory] = useState<TrafficPoint[]>([]);
  const [requestLog, setRequestLog] = useState<RequestLogEntry[]>([]);
  const [alert, setAlert] = useState<AlertInfo | null>(null);
  const wsRef = useRef<RouteBoxWebSocket | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load cached stats as initial state (only before live data arrives)
  const connectedRef = useRef(false);
  useEffect(() => {
    loadCachedStats().then((cached) => {
      if (cached && !connectedRef.current) {
        setStats((prev) => prev ?? cached);
        setStale(true);
      }
    });
  }, []);

  // ── Cloud mode: REST polling ─────────────────────────────────────────────
  useEffect(() => {
    if (!ready || getGatewayMode() !== "cloud") return;

    let cancelled = false;
    let lastId: string | undefined;

    // Mark as connected immediately for cloud mode
    connectedRef.current = true;
    setConnected(true);
    setStale(false);

    const controller = new AbortController();

    async function poll() {
      if (cancelled) return;
      try {
        const res = await api.cloudGetRequests(lastId);
        if (cancelled) return; // Check again after await
        if (res.requests.length > 0) {
          lastId = res.requests[res.requests.length - 1].id;
          setRequestLog((prev) => {
            const existingIds = new Set(prev.map((e) => e.id));
            const newEntries = res.requests.filter((e) => !existingIds.has(e.id));
            if (newEntries.length === 0) return prev;
            const next = [...prev, ...newEntries];
            return next.length > MAX_LOG_ENTRIES ? next.slice(-MAX_LOG_ENTRIES) : next;
          });
        }
      } catch {
        // Silent — best-effort polling
      }
    }

    // Initial fetch
    poll();
    let timer = setInterval(poll, CLOUD_POLL_INTERVAL);

    // Pause polling when tab is hidden, resume on visible
    const onVisibility = () => {
      if (document.hidden) {
        clearInterval(timer);
      } else {
        poll();
        timer = setInterval(poll, CLOUD_POLL_INTERVAL);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      controller.abort();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [ready]);

  // ── Local mode: WebSocket ────────────────────────────────────────────────
  useEffect(() => {
    if (!ready || getGatewayMode() === "cloud") return;

    // Pass a function so each connect/reconnect gets the latest token URL
    const ws = new RouteBoxWebSocket(() => getWsUrl());
    wsRef.current = ws;

    ws.on("open", () => {
      connectedRef.current = true;
      setConnected(true);
      setStale(false);
    });
    ws.on("close", () => { connectedRef.current = false; setConnected(false); });

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
  }, [ready]);

  const disconnect = useCallback(() => {
    wsRef.current?.disconnect();
  }, []);

  const dismissAlert = useCallback(() => {
    setAlert(null);
  }, []);

  return { stats, connected, stale, history, requestLog, alert, dismissAlert, disconnect };
}
