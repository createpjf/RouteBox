/**
 * Brave Search API integration for RouteBox web search.
 * Calls the Brave Web Search API to fetch real-time search results,
 * which are then injected into LLM context as a system message.
 */

import { loadSetting } from "./db";

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

const BRAVE_SEARCH_URL = "https://api.search.brave.com/res/v1/web/search";

/**
 * Get the Brave Search API key from settings or environment.
 */
export function getBraveApiKey(): string | null {
  const settingKey = loadSetting("braveSearchApiKey");
  if (settingKey) return settingKey;
  const envKey = process.env.BRAVE_API_KEY;
  if (envKey) return envKey;
  return null;
}

/**
 * Check if Brave Search is enabled (has a valid API key configured).
 */
export function isSearchEnabled(): boolean {
  return !!getBraveApiKey();
}

/**
 * Perform a web search using the Brave Search API.
 * @param query - The search query string
 * @param count - Max number of results to return (default: 5)
 * @returns Array of search results with title, url, and snippet
 */
export async function braveSearch(query: string, count = 5): Promise<SearchResult[]> {
  const apiKey = getBraveApiKey();
  if (!apiKey) {
    throw new Error("Brave Search API key not configured");
  }

  const params = new URLSearchParams({
    q: query,
    count: String(count),
    text_decorations: "false",
    search_lang: "en",
  });

  const res = await fetch(`${BRAVE_SEARCH_URL}?${params}`, {
    headers: {
      Accept: "application/json",
      "Accept-Encoding": "gzip",
      "X-Subscription-Token": apiKey,
    },
    signal: AbortSignal.timeout(8000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Brave Search API error ${res.status}: ${body}`);
  }

  const data = (await res.json()) as {
    web?: {
      results?: {
        title: string;
        url: string;
        description: string;
      }[];
    };
  };

  const results: SearchResult[] = (data.web?.results ?? []).slice(0, count).map((r) => ({
    title: r.title,
    url: r.url,
    snippet: r.description,
  }));

  return results;
}

/**
 * Format search results into a system message for LLM context injection.
 */
export function formatSearchContext(results: SearchResult[]): string {
  if (results.length === 0) return "";

  const lines = results.map(
    (r, i) => `${i + 1}. ${r.title} (${r.url})\n   ${r.snippet}`
  );

  return [
    "[Web Search Results]",
    ...lines,
    "",
    "Use these search results to inform your response. Cite sources when relevant.",
  ].join("\n");
}
