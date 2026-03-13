const MAX_CHAT_HISTORY = 30;

export const buildChatHistory = (memory = []) => {
  // Take only the most recent messages to avoid bloating the prompt
  const recentMemory = memory.slice(-MAX_CHAT_HISTORY);

  return recentMemory.map((m) => ({
    role: m.sender === "user" ? "user" : "assistant",
    content: m.message,
    message_at: m.created_at,
  }));
};
