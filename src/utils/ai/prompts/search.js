/**
 * Prompt for refining user questions into search keywords.
 */

export const SEARCH_REFINE_PROMPT = `
Extract 3-5 search keywords from the question below.
- Focus on: Primary Topic, Specific Service/Product, and User Intent.
- If the question is in another language, provide keywords in BOTH English and the detected language.
- DO NOT use generic words like "how", "to", "the", "what", "is", "can".
- Return ONLY space-separated keywords. No sentences, no punctuation, no explanations.

Question: "{QUESTION}"

Keywords:`;
