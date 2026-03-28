/**
 * Prompts for lead summarization logic.
 */

export const getLeadSummarizePrompt = (instruction, memoryJson) => `
You are an AI assistant helping a Business Admin. 
Task: ${instruction}

Rules:
- Simple English, no jargon. 
- Max 3-5 lines.
- DO NOT mention specific dates/days.
- Focus on meaning. No "User:" labels.
- No preamble.

Conversation History:
${memoryJson}
`;

/**
 * Returns specific instructions based on the requested summary mode.
 */
export const getLeadSummaryModeInstruction = (mode, startDate, endDate) => {
  if (mode === "timeframe") {
    return startDate === endDate
      ? `Summarize what happened on ${startDate} in 3-4 simple sentences. Explain what the client wanted and the result. Max 5 lines.`
      : `Summarize interactions between ${startDate} and ${endDate} in 4-5 simple sentences. Explain the main topic and status. Max 5 lines.`;
  }

  if (mode === "detailed") {
    return `Provide a chronological daily log. For each date, give 1 simple sentence. 
      Format: **YYYY-MM-DD**: [1-sentence summary]`;
  }

  // Default / Overall mode
  return `Provide a simple "Status Report" in 3-5 lines.
      - Who is the client and why did they reach out?
      - What are the key details?
      - What is the current status and next steps?
      Keep it simple and easy to read.`;
};
