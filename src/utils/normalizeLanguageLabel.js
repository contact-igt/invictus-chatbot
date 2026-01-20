export function normalizeLanguageLabel(result) {
  if (!result || !result.language) {
    return {
      language: "unknown",
      style: "unknown",
      label: "unknown",
    };
  }

  const language = result.language;
  const style = result.style;

  const romanizedMap = {
    Tamil: "tanglish",
    Hindi: "hinglish",
    Malayalam: "manglish",
    Telugu: "teluglish",
    Kannada: "kannadalish",
    Bengali: "benglish",
    Marathi: "marathlish",
    Gujarati: "gujlish",
    Punjabi: "punjlish",
    Urdu: "urdlish",
    Assamese: "assamlish",
    Odia: "odialish",
    Nepali: "nepalish",
    Kashmiri: "kashmirlish",
    Konkani: "konkanlish",
    Sindhi: "sindhlish",
    Manipuri: "manipurish",
    Bodo: "bodolish",
    Santhali: "santhalish",
    Dogri: "dogrilish",
    Maithili: "maithlish",
    Sanskrit: "sanskritlish",
    English: "english",
  };

  if (style === "romanized") {
    return {
      ...result,
      label: romanizedMap[language] || `${language.toLowerCase()}lish`,
    };
  }

  if (style === "native_script") {
    return {
      ...result,
      label: language.toLowerCase(),
    };
  }

  if (style === "mixed") {
    return {
      ...result,
      label: `${language.toLowerCase()}_mixed`,
    };
  }

  return {
    ...result,
    label: language.toLowerCase(),
  };
}
