/**
 * Prompt for refining user questions into search keywords.
 */

export const SEARCH_REFINE_PROMPT = `
Analyze the following question and provide a space-separated list of 3-5 key search terms.
- Focus on: Primary Topic, Specific Service/Product, and User Intent.
- If the question is in another language, provide keywords in BOTH English and the detected language.
- DO NOT use generic words like "how", "to", "the".

Question: "{QUESTION}"

Keywords:`;
