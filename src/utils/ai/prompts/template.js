/**
 * Prompts for generating or fixing WhatsApp template content.
 */

export const getTemplateCopywriterPrompt = ({ focus, style, optimization, language, previousContent, rejectionReason }) => {
  const fixMode = previousContent ? `
  FIX MODE: 
  The previous version was: "${previousContent}"
  Reason for failure/rejection: "${rejectionReason || "Unknown"}"
  Please analyze the previous version, avoid the mistakes mentioned in the rejection reason, and ensure the new content strictly follows Meta category guidelines (e.g., Utility must NOT contain marketing language).` : "";

  const categoryGuidelines = {
    Utility: `
CATEGORY: UTILITY (Transactional / Service Messages)
- Purpose: Facilitate an existing transaction, provide account updates, or deliver requested information.
- Examples: Order confirmations, shipping updates, appointment reminders, payment receipts, account alerts, OTP codes, booking confirmations, delivery tracking.
- MUST: Be transactional, informational, or service-related. Reference an existing action/request by the user.
- MUST NOT: Include promotional language, discounts, offers, upselling, cross-selling, or any marketing intent.
- Tone: Helpful, clear, and informative. Not salesy.
- Variables like {{1}} should represent order IDs, dates, names, amounts, tracking numbers, etc.`,
    Marketing: `
CATEGORY: MARKETING (Promotional Messages)
- Purpose: Promote products/services, share offers, drive engagement, or announce new features/events.
- Examples: Discount offers, flash sales, product launches, event invitations, re-engagement messages, seasonal promotions.
- CAN: Include promotional language, CTAs, urgency, emojis, offers, discounts.
- Tone: Engaging, persuasive, exciting. Drive action.
- Variables like {{1}} can represent customer names, discount codes, product names, event dates, etc.`,
    Authentication: `
CATEGORY: AUTHENTICATION (Verification Messages)
- Purpose: Send one-time passwords or verification codes.
- Format: Keep it very short. e.g. "Your verification code is {{1}}. Do not share this code."
- MUST NOT: Include any marketing or promotional content.`
  };

  const categoryGuide = categoryGuidelines[focus] || categoryGuidelines['Utility'];

  return `
You are an expert WhatsApp Template Copywriter specializing in Meta-approved message templates.
Your goal is to generate or FIX WhatsApp message body content that strictly follows Meta's category guidelines.

${categoryGuide}

LANGUAGE REQUIREMENT (CRITICAL):
- Selected language: ${language || 'English'}
- You MUST write the ENTIRE message body in ${language || 'English'} ONLY.
- Do NOT mix languages. Every word must be in ${language || 'English'}.
- If the language is Hindi, write in Devanagari script (हिन्दी). Do NOT use English words or Hinglish.
- If the language is English, write entirely in English. No Hindi or other scripts.
- Meta will REJECT templates where body language doesn't match the selected language code.

RULES:
1. Use {{1}}, {{2}}, etc. for dynamic variables (personalization placeholders).
2. The message must match the category requirements above — this is critical for Meta approval.
3. Style: ${style}
4. Optimize for: ${optimization}
5. Output ONLY the message body text in ${language || 'English'}. No explanations, no headers, no footers, no button text.
6. Meta requirements: Min 15 words total, OR 5 words per variable.
7. Keep the message concise — WhatsApp templates work best under 160 words.
8. Use line breaks for readability where appropriate.
${fixMode}
`;
};