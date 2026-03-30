import * as leadSource from "./leadSource.js";
import * as emailCapture from "./emailCapture.js";

const handlers = {
  LEAD_SOURCE: leadSource,
  EMAIL_CAPTURE: emailCapture,
};

// Extract tag payload by finding the matching closing bracket,
// properly handling nested brackets inside JSON values
const extractTagWithPayload = (response) => {
  // Find a known tag name pattern
  const tagStartRegex = /\[([A-Z_]+):\s*/g;
  const match = tagStartRegex.exec(response);
  if (!match) return null;

  const tagName = match[1];
  const payloadStart = match.index + match[0].length;

  // Walk forward counting brackets to find the real end
  let depth = 0;
  let inString = false;
  let escaped = false;
  let end = -1;

  for (let i = payloadStart; i < response.length; i++) {
    const ch = response[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\" && inString) {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{" || ch === "[") depth++;
    if (ch === "}") depth--;
    if (ch === "]") {
      if (depth <= 0) {
        end = i;
        break;
      }
      depth--;
    }
  }

  if (end === -1) return null; // No matching closing bracket found (truncated)

  const payload = response.substring(payloadStart, end).trim();
  const fullTag = response.substring(match.index, end + 1);
  return { tagName, payload, fullTag };
};

export const processResponse = async (fullResponse, context) => {
  if (!fullResponse) {
    return { message: fullResponse, tagDetected: null, tagPayload: null };
  }

  let tagDetected = null;
  let tagPayload = null;

  // Try bracket-balanced extraction first (handles JSON with brackets in values)
  const extracted = extractTagWithPayload(fullResponse);
  if (extracted) {
    tagDetected = extracted.tagName;
    tagPayload = extracted.payload;
  }

  // Also check for simple tags without payloads: [TAG_NAME]
  if (!tagDetected) {
    const simpleTagRegex = /\[([A-Z_]+)\]/g;
    const simpleMatch = simpleTagRegex.exec(fullResponse);
    if (simpleMatch) {
      tagDetected = simpleMatch[1];
    }
  }

  // Remove the tag from the message
  let cleanMessage;
  if (extracted) {
    cleanMessage = fullResponse.replace(extracted.fullTag, "").trim();
  } else {
    // Fallback: remove any [TAG] patterns
    cleanMessage = fullResponse
      .replace(/\[([A-Z_]+)(?::\s*[\s\S]*?)?\]/g, "")
      .trim();
  }

  if (!tagDetected) {
    const plainRegex = /(.*?)\s+(missing_knowledge|out_of_scope)\s*$/is;
    const plainMatch = cleanMessage.match(plainRegex);

    if (plainMatch) {
      const [_, strippedMessage, tag] = plainMatch;
      return {
        message: strippedMessage.trim(),
        tagDetected: tag.toUpperCase(),
        tagPayload: null,
      };
    }
  }

  if (tagDetected && handlers[tagDetected]?.execute) {
    // Tag detected — handler will be executed separately by the caller
    // to ensure correct message ordering
    console.log(`[TAG-PROCESSOR] Detected tag: ${tagDetected}`);
  }

  return {
    message: cleanMessage,
    tagDetected,
    tagPayload,
  };
};

// Execute a tag handler — call this AFTER sending the AI reply to the user
export const executeTagHandler = async (
  tagDetected,
  tagPayload,
  context,
  cleanMessage,
) => {
  if (!tagDetected) {
    console.log("[TAG-HANDLER] No tag detected");
    return;
  }

  if (!handlers[tagDetected]) {
    console.error(`[TAG-HANDLER] Unknown tag: ${tagDetected}`);
    return;
  }

  if (!handlers[tagDetected]?.execute) {
    console.error(
      `[TAG-HANDLER] Handler for ${tagDetected} has no execute method`,
    );
    return;
  }

  console.log(
    `[TAG-HANDLER] Executing ${tagDetected} with payload: ${tagPayload?.substring(0, 200)}`,
  );
  console.log(`[TAG-HANDLER] Context:`, JSON.stringify(context));

  try {
    await handlers[tagDetected].execute(tagPayload, context, cleanMessage);
    console.log(`[TAG-HANDLER] ${tagDetected} completed successfully`);
  } catch (err) {
    console.error(
      `[TAG-HANDLER] Error executing ${tagDetected}:`,
      err.message,
      err.stack,
    );
  }
};
