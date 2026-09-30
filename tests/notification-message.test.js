import assert from "node:assert/strict";
import test from "node:test";
import { latestAssistantReply, truncateText } from "../notification-message.js";

test("truncateText keeps short strings and cuts long ones with an ellipsis", () => {
  assert.equal(truncateText("short title", 40), "short title");
  const long = "x".repeat(50);
  assert.equal(truncateText(long, 40), `${"x".repeat(40)}…`);
  // Grapheme-safe: surrogate pairs count once.
  const emoji = "🙂".repeat(45);
  assert.equal(truncateText(emoji, 40), `${"🙂".repeat(40)}…`);
});

test("latestAssistantReply returns the last text part of the last assistant message", () => {
  const reply = latestAssistantReply([
    { type: "user", content: [{ type: "text", text: "do it" }] },
    { type: "assistant", content: [
      { type: "text", text: "working on it" },
      { type: "tool", name: "bash" },
    ] },
    { type: "assistant", content: [
      { type: "reasoning", text: "hidden" },
      { type: "text", text: "first line\n\nsecond   line" },
    ] },
  ]);

  assert.equal(reply, "first line second line");
});

test("latestAssistantReply truncates long replies", () => {
  const reply = latestAssistantReply([
    { type: "assistant", content: [{ type: "text", text: "y".repeat(100) }] },
  ]);

  assert.equal(reply, `${"y".repeat(80)}…`);
});

test("latestAssistantReply skips non-assistant and non-text content", () => {
  assert.equal(latestAssistantReply([
    { type: "user", content: [{ type: "text", text: "hi" }] },
    { type: "assistant", content: [{ type: "reasoning", text: "nope" }] },
    { type: "assistant", content: [{ type: "tool", name: "read" }] },
  ]), "");

  assert.equal(latestAssistantReply([]), "");
  assert.equal(latestAssistantReply(undefined), "");
  assert.equal(latestAssistantReply([
    { type: "assistant", content: [{ type: "text", text: "   \n  " }] },
    { type: "assistant", content: [{ type: "text", text: "real answer" }] },
  ]), "real answer");
});
