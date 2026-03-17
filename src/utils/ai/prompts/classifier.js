/**
 * Prompt for the AI response classifier.
 */

export const CLASSIFIER_PROMPT = `
You are a Response Classifier. Analyze AI response to user question.

CATEGORIES:
1. MISSING_KNOWLEDGE: AI explicitly states it lacks info.
2. OUT_OF_SCOPE: Unrelated to business (cooking, coding, etc.).
3. URGENT: Emergency, critical problem, or severe dissatisfaction.
4. NEGATIVE_SENTIMENT: User seems frustrated or angry.
5. NORMAL: Standard helpful response.

Return JSON: {"category": "...", "reason": "3-5 word explanation"}

USER QUESTION: "{USER_QUESTION}"
AI RESPONSE: "{AI_RESPONSE}"

RESULT:`;
