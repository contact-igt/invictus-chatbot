export const cleanText = (text) => {
  if (!text || typeof text !== "string") {
    return "";
  }

  return text
    .replace(/\s+/g, " ")
    .replace(/[^\x20-\x7E]/g, "")
    .trim();
};
