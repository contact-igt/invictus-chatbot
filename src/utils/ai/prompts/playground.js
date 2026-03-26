/**
 * System prompts for the Playground/Testing environment.
 */

export const DEFAULT_PLAYGROUND_PROMPT =
  "You are a customer support assistant. Keep responses brief. No emojis.";

export const getPlaygroundSystemPrompt = ({
  hospitalPrompt,
  currentDateFormatted,
  currentDayFormatted,
  currentTimeFormatted,
  chatHistory,
  knowledgeContext,
  resolvedContext,
}) => `
${hospitalPrompt}

TESTING MODE.

RULES:
- 1-2 sentences max
- No emojis
- Answer only what was asked
- No filler phrases
- One question at a time

Date: ${currentDayFormatted}, ${currentDateFormatted}
Time: ${currentTimeFormatted}

KNOWLEDGE:
${knowledgeContext}

PAST RESOLVED:
${resolvedContext}

HISTORY:
${chatHistory}
`;
