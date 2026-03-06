// ---------------------------------------------------------------------------
// Request Context — extract signals from the request body for scoring engine
// ---------------------------------------------------------------------------

export interface RequestContext {
  hasImage: boolean;
  hasFunctionSchema: boolean;
  estimatedInputTokens: number;
  maxOutputTokens: number;
  contentType: "code" | "long_text" | "general";
  detectedLanguage: "zh" | "en";
  isStreaming: boolean;
}

// ---------------------------------------------------------------------------
// Code detection
// ---------------------------------------------------------------------------

const CODE_KEYWORDS = [
  "function ", "class ", "def ", "import ", "export ", "const ", "let ", "var ",
  "return ", "if (", "for (", "while (", "switch (", "try {", "catch (",
  "async ", "await ", "interface ", "type ", "enum ", "struct ", "impl ",
  "#include", "#define", "console.log", "print(",
  "SELECT ", "INSERT ", "UPDATE ", "CREATE TABLE",
];

const CODE_BLOCK_RE = /```[\s\S]*?```/;

// ---------------------------------------------------------------------------
// Build context from OpenAI-format request body
// ---------------------------------------------------------------------------

export function buildRequestContext(body: {
  messages?: { role: string; content: unknown }[];
  tools?: unknown[];
  functions?: unknown[];
  stream?: boolean;
  max_tokens?: number;
}): RequestContext {
  let hasImage = false;
  let hasFunctionSchema = !!(body.tools?.length || body.functions?.length);
  let totalChars = 0;
  let codeMarkers = 0;
  let hasCodeBlocks = false;
  let zhChars = 0;

  if (Array.isArray(body.messages)) {
    for (const msg of body.messages) {
      const { text, containsImage } = extractContent(msg.content);
      if (containsImage) hasImage = true;
      totalChars += text.length;

      // Code detection
      if (CODE_BLOCK_RE.test(text)) {
        hasCodeBlocks = true;
        codeMarkers += 2;
      }
      for (const kw of CODE_KEYWORDS) {
        if (text.includes(kw)) codeMarkers++;
      }

      // Chinese char count (charCode range — faster than per-char regex)
      for (let i = 0; i < text.length; i++) {
        const c = text.charCodeAt(i);
        if (c >= 0x4e00 && c <= 0x9fff) zhChars++;
      }
    }
  }

  // Content type classification
  let contentType: "code" | "long_text" | "general" = "general";
  if (codeMarkers >= 3 || hasCodeBlocks) {
    contentType = "code";
  } else if (totalChars >= 8000) {
    contentType = "long_text";
  }

  // Language: if >10% of chars are CJK → zh
  const detectedLanguage: "zh" | "en" = totalChars > 0 && zhChars / totalChars > 0.1 ? "zh" : "en";

  // Weighted token estimate — blend CJK (~2 chars/token) and Latin (~4 chars/token)
  const zhRatio = totalChars > 0 ? zhChars / totalChars : 0;
  const avgCharsPerToken = 2 * zhRatio + 4 * (1 - zhRatio);
  const estimatedInputTokens = Math.ceil(totalChars / avgCharsPerToken);

  return {
    hasImage,
    hasFunctionSchema,
    estimatedInputTokens,
    maxOutputTokens: body.max_tokens ?? 4096,
    contentType,
    detectedLanguage,
    isStreaming: body.stream === true,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractContent(content: unknown): { text: string; containsImage: boolean } {
  if (typeof content === "string") return { text: content, containsImage: false };

  if (Array.isArray(content)) {
    let text = "";
    let containsImage = false;
    for (const part of content) {
      if (part?.type === "text") {
        text += (part.text ?? "") + "\n";
      } else if (part?.type === "image_url" || part?.type === "image") {
        containsImage = true;
      }
    }
    return { text, containsImage };
  }

  return { text: "", containsImage: false };
}
