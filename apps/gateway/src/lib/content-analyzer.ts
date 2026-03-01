// ---------------------------------------------------------------------------
// Content analysis — classify request messages for content-aware routing
// ---------------------------------------------------------------------------

export type ContentType = "code" | "long_text" | "general";

export interface ContentAnalysis {
  type: ContentType;
  totalChars: number;
  codeMarkerCount: number;
  hasCodeBlocks: boolean;
}

// Code detection markers
const CODE_KEYWORDS = [
  "function ", "class ", "def ", "import ", "export ", "const ", "let ", "var ",
  "return ", "if (", "for (", "while (", "switch (", "try {", "catch (",
  "async ", "await ", "interface ", "type ", "enum ", "struct ", "impl ",
  "package ", "public ", "private ", "protected ",
  "#include", "#define", "#import",
  "console.log", "print(", "println!", "fmt.",
  "SELECT ", "INSERT ", "UPDATE ", "DELETE ", "CREATE TABLE",
];

const CODE_BLOCK_REGEX = /```[\s\S]*?```/g;
const INLINE_CODE_REGEX = /`[^`]+`/g;

export function analyzeContent(
  messages: { role: string; content: unknown }[],
): ContentAnalysis {
  let totalChars = 0;
  let codeMarkerCount = 0;
  let hasCodeBlocks = false;

  for (const msg of messages) {
    const text = extractText(msg.content);
    totalChars += text.length;

    // Check for fenced code blocks
    const codeBlocks = text.match(CODE_BLOCK_REGEX);
    if (codeBlocks && codeBlocks.length > 0) {
      hasCodeBlocks = true;
      codeMarkerCount += codeBlocks.length * 2; // code blocks are strong signals
    }

    // Check for inline code
    const inlineCode = text.match(INLINE_CODE_REGEX);
    if (inlineCode) {
      codeMarkerCount += Math.min(inlineCode.length, 3); // cap contribution
    }

    // Check for code keywords
    const lowerText = text.toLowerCase();
    for (const kw of CODE_KEYWORDS) {
      if (lowerText.includes(kw.toLowerCase())) {
        codeMarkerCount++;
      }
    }
  }

  // Classify
  let type: ContentType = "general";
  if (codeMarkerCount >= 3 || hasCodeBlocks) {
    type = "code";
  } else if (totalChars >= 8000) {
    type = "long_text";
  }

  return { type, totalChars, codeMarkerCount, hasCodeBlocks };
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter(
        (part: Record<string, unknown>) => part.type === "text",
      )
      .map((part: Record<string, unknown>) => part.text as string)
      .join("\n");
  }
  return "";
}
