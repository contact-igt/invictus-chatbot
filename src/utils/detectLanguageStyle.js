export const detectLanguageStyle = (text = "") => {
  if (/[\u0B80-\u0BFF]/.test(text)) return "TAMIL_NATIVE";     // தமிழ் எழுத்து
  if (/[\u0900-\u097F]/.test(text)) return "DEVANAGARI";      // हिंदी
  return "LATIN"; // English letters / Tanglish / Hinglish
};
