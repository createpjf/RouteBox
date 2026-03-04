// V2 shared types for Chat, Spotlight, and Usage features

export interface Conversation {
  id: string;
  title: string;
  model: string;
  strategy: string;
  msg_count: number;
  total_tokens: number;
  total_cost: number;
  pinned: number;
  archived: number;
  created_at: number;
  updated_at: number;
}

export interface Message {
  id: string;
  conversation_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  model: string;
  provider: string;
  input_tokens: number;
  output_tokens: number;
  cost: number;
  latency_ms: number;
  cache_hit: number;
  created_at: number;
}

export interface SpotlightEntry {
  id: string;
  prompt: string;
  response: string;
  model: string;
  provider: string;
  cost: number;
  tokens: number;
  latency_ms: number;
  created_at: number;
}

export interface RouteboxMeta {
  object: "routebox.meta";
  provider: string;
  model: string;
  requested_model: string;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  cost: number;
  latency_ms: number;
  is_fallback: boolean;
}
