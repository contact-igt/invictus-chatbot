import * as leadSource from "./leadSource.js";
import * as appointmentTag from "./appointmentTag.js";

const handlers = {
    LEAD_SOURCE: leadSource,
    BOOK_APPOINTMENT: appointmentTag,
};

export const processResponse = async (fullResponse, context) => {
    if (!fullResponse) {
        return { message: fullResponse, tagDetected: null, tagPayload: null };
    }

    const tagRegex = /\[([A-Z_]+)(?::\s*(.*?))?\]/g;

    let tagDetected = null;
    let tagPayload = null;

    const firstMatch = tagRegex.exec(fullResponse);
    if (firstMatch) {
        tagDetected = firstMatch[1];
        tagPayload = firstMatch[2] ? firstMatch[2].trim() : null;
    }


    tagRegex.lastIndex = 0;
    const cleanMessage = fullResponse.replace(tagRegex, "").trim();

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

    if (tagDetected && handlers[tagDetected]?.execute) {
        try {
            handlers[tagDetected].execute(tagPayload, context, cleanMessage);
        } catch (err) {
            console.error(`[TAG-HANDLER] Error executing ${tagDetected}:`, err.message);
        }
    }

    return {
        message: cleanMessage,
        tagDetected,
        tagPayload
    };
};
