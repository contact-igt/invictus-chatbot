import * as missingKnowledge from "./missingKnowledge.js";
import * as outOfScope from "./outOfScope.js";

// Registry of handlers
const handlers = {
    MISSING_KNOWLEDGE: missingKnowledge,
    OUT_OF_SCOPE: outOfScope,
    // Add future handlers here (e.g., URGENT, SENTIMENT)
};

/**
 * Processes the AI response to detect and handle tags.
 *
 * Pattern: [TAG_NAME: Optional Payload] Actual Message
 * Example: [MISSING_KNOWLEDGE: Pricing missing] I cannot find the price.
 *
 * @param {string} fullResponse - The raw response from OpenAI
 * @param {object} context - Context object { tenant_id, userMessage }
 * @returns {{message: string, tagDetected: string|null, tagPayload: string|null}} - An object containing the message, detected tag, and its payload.
 */
export const processResponse = async (fullResponse, context) => {
    if (!fullResponse) {
        return { message: fullResponse, tagDetected: null, tagPayload: null };
    }

    // 1. Global regex to find all [TAG: payload] or [TAG] blocks
    const tagRegex = /\[([A-Z_]+)(?::\s*(.*?))?\]/g;

    let tagDetected = null;
    let tagPayload = null;

    // Capture the first tag for metadata purposes
    const firstMatch = tagRegex.exec(fullResponse);
    if (firstMatch) {
        tagDetected = firstMatch[1];
        tagPayload = firstMatch[2] ? firstMatch[2].trim() : null;
    }

    // 2. Clear all tags from the message body
    // Reset regex lastIndex before using it for replace, as exec advances it
    tagRegex.lastIndex = 0;
    const cleanMessage = fullResponse.replace(tagRegex, "").trim();

    // 3. Fallback for plain lowercase tags at the end (User's specific preference)
    // Only if no structured tags were found
    if (!tagDetected) {
        const plainRegex = /(.*?)\s+(missing_knowledge|out_of_scope)\s*$/is;
        const plainMatch = cleanMessage.match(plainRegex);

        if (plainMatch) {
            const [_, strippedMessage, tag] = plainMatch;
            return {
                message: strippedMessage.trim(),
                tagDetected: tag.toUpperCase(),
                tagPayload: null
            };
        }
    }

    return {
        message: cleanMessage,
        tagDetected,
        tagPayload
    };
};
