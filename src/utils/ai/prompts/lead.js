/**
 * Prompts for lead summarization logic.
 */

export const getLeadSummarizePrompt = (instruction, memoryJson) => `
You are summarizing a WhatsApp conversation between a business and a customer.

Task: ${instruction}

Rules:
- Plain English, no jargon.
- Do NOT mention specific dates or timestamps.
- Focus on: what the customer wanted, what was discussed, and the outcome/status.
- No labels like "User:" or "Bot:".
- No introductory phrases like "Here is the summary".
- Output the summary directly.

Conversation:
${memoryJson}
`;

/**
 * Returns specific instructions based on the requested summary mode.
 */
export const getLeadSummaryModeInstruction = (mode, startDate, endDate) => {
  if (mode === "timeframe") {
    return startDate === endDate
      ? `Summarize what happened on ${startDate} in 2-3 sentences. State what the customer needed and the result.`
      : `Summarize interactions from ${startDate} to ${endDate} in 3-4 sentences. Cover the main topic, actions taken, and current status.`;
  }

  if (mode === "detailed") {
    return `Provide a chronological daily log. For each date with activity, write one sentence.
Format: **YYYY-MM-DD**: [one-sentence summary]`;
  }

  // Default / Overall mode
  return `Write a 3-5 line status report covering:
1. Who is this customer and why did they contact the business?
2. Key details discussed (services, appointments, issues).
3. Current status and any pending next steps.`;
};
