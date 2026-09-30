const TITLE_MAX_CHARS = 40;
const REPLY_MAX_CHARS = 80;

// Truncates a display string to maxChars grapheme clusters plus an ellipsis.
export function truncateText(text, maxChars) {
  const chars = [...String(text ?? "")];
  if (chars.length <= maxChars) return chars.join("");
  return `${chars.slice(0, maxChars).join("")}…`;
}

function compactWhitespace(text) {
  return text.replace(/\s+/g, " ").trim();
}

// Extracts the final text part of the most recent assistant message, so a
// notification can show what the agent last said without leaking tool noise.
export function latestAssistantReply(messages, maxChars = REPLY_MAX_CHARS) {
  if (!Array.isArray(messages)) return "";

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.type !== "assistant" || !Array.isArray(message.content)) continue;

    for (let part = message.content.length - 1; part >= 0; part -= 1) {
      const content = message.content[part];
      if (content?.type !== "text" || typeof content.text !== "string") continue;
      const reply = compactWhitespace(content.text);
      if (reply) return truncateText(reply, maxChars);
    }
  }

  return "";
}
