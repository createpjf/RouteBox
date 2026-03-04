/**
 * Strip <think>...</think> reasoning blocks from model output.
 * Handles both complete and in-progress (streaming) blocks.
 */
export function stripThinkingTags(text: string): { content: string; thinking: string } {
  let thinking = "";
  let content = text;

  // Extract completed <think>...</think> blocks
  const completeBlocks = content.match(/<think>[\s\S]*?<\/think>/g);
  if (completeBlocks) {
    for (const block of completeBlocks) {
      thinking += block.slice(7, -8).trim() + "\n";
    }
    content = content.replace(/<think>[\s\S]*?<\/think>\s*/g, "");
  }

  // During streaming: if there's an unclosed <think>, hide from <think> to end
  const openIdx = content.lastIndexOf("<think>");
  if (openIdx !== -1 && content.indexOf("</think>", openIdx) === -1) {
    thinking += content.slice(openIdx + 7).trim();
    content = content.slice(0, openIdx);
  }

  return { content: content.trimStart(), thinking: thinking.trim() };
}
