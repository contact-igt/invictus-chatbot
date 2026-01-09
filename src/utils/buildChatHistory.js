export const buildChatHistory = (memory = []) => {
  return memory.map((m) => ({
    role: m.sender === "user" ? "user" : "assistant",
    content: m.message,
  }));
};
