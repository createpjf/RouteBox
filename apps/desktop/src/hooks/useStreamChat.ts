import { useState, useRef, useCallback, useEffect } from "react";
import { getGatewayUrl, getAuthToken, getGatewayMode, getRoutingStrategy, getRoutingRules } from "../lib/constants";
import type { RouteboxMeta } from "../types/chat";

interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

interface UseStreamChatReturn {
  streaming: boolean;
  streamedText: string;
  meta: RouteboxMeta | null;
  sendMessage: (messages: ChatMessage[], model: string, options?: { search?: boolean }) => Promise<void>;
  abort: () => void;
  clearStream: () => void;
}

export function useStreamChat(): UseStreamChatReturn {
  const [streaming, setStreaming] = useState(false);
  const [streamedText, setStreamedText] = useState("");
  const [meta, setMeta] = useState<RouteboxMeta | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Abort in-progress stream on unmount
  useEffect(() => {
    return () => { abortRef.current?.abort(); };
  }, []);

  const abort = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStreaming(false);
  }, []);

  const clearStream = useCallback(() => {
    setStreamedText("");
    setMeta(null);
  }, []);

  const sendMessage = useCallback(
    async (messages: ChatMessage[], model: string, options?: { search?: boolean }) => {
      // Reset state
      setStreamedText("");
      setMeta(null);
      setStreaming(true);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const token = getAuthToken();
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
        };
        if (token) headers["Authorization"] = `Bearer ${token}`;

        // Inject cloud routing preferences via headers
        if (getGatewayMode() === "cloud") {
          const strategy = getRoutingStrategy();
          if (strategy && strategy !== "smart_auto") {
            headers["x-routebox-strategy"] = strategy;
          }
          const rules = getRoutingRules();
          if (rules.length > 0) {
            headers["x-routebox-rules"] = JSON.stringify(rules);
          }
        }

        const res = await fetch(`${getGatewayUrl()}/v1/chat/completions`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            model,
            messages,
            stream: true,
            ...(options?.search ? { routebox_search: true } : {}),
          }),
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          const err = await res.text().catch(() => "Stream error");
          throw new Error(err);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let accumulated = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop()!;

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const data = line.slice(6).trim();
            if (data === "[DONE]") continue;

            try {
              const parsed = JSON.parse(data);

              // Capture routebox.meta chunk
              if (parsed.object === "routebox.meta") {
                setMeta(parsed as RouteboxMeta);
                continue;
              }

              // Standard OpenAI chunk
              const delta = parsed.choices?.[0]?.delta;
              if (delta?.content) {
                accumulated += delta.content;
                setStreamedText(accumulated);
              }
            } catch {
              // skip malformed
            }
          }
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          setStreamedText((prev) => prev || `Error: ${(err as Error).message}`);
        }
      } finally {
        setStreaming(false);
        abortRef.current = null;
      }
    },
    [],
  );

  return { streaming, streamedText, meta, sendMessage, abort, clearStream };
}
