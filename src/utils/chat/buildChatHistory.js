const MAX_CHAT_HISTORY = 30;

// Produce a text representation of any message type for AI context.
// Past images aren't re-sent to vision API — they're described as text so
// the AI understands what was discussed without inflating vision token costs.
function formatMessageContent(m) {
  switch (m.message_type) {
    case "image":
      return m.message ? `[Image sent — caption: "${m.message}"]` : "[Image sent]";
    case "video":
      return m.message ? `[Video sent — caption: "${m.message}"]` : "[Video sent]";
    case "audio":
      return "[Voice message sent]";
    case "document":
      return m.media_filename ? `[Document sent: ${m.media_filename}]` : "[Document sent]";
    default:
      return m.message || "";
  }
}

export const buildChatHistory = (memory = []) => {
  // Take only the most recent messages to avoid bloating the prompt
  const recentMemory = memory.slice(-MAX_CHAT_HISTORY);

  return recentMemory.map((m) => ({
    role: m.sender === "user" ? "user" : "assistant",
    content: formatMessageContent(m),
    message_at: m.created_at,
  }));
};
