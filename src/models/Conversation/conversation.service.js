import db from "../../database/index.js";
import { tableNames } from "../../database/tableName.js";
import { findUserMessageService } from "../Ai/ai.service.js";
import { updateAppSettingService } from "../AppSettings/appsetting.service.js";
import { addContactDetailService } from "../Contacts/contacts.service.js";

const PROFESSIONAL_SYSTEM_PROMPT = `
You are a professional business assistant.

Rules:
- Reply only in clear professional English.
- Do not use emojis.
- Do not use symbols or special characters.
- Keep replies short and direct.
- Do not add greetings unless required.
- Do not explain reasoning.
`;

export const findConversationByPhoneService = async (phone) => {
  const q = `
    SELECT *
    FROM ${tableNames.CONVERSATION}
    WHERE phone = ?
    LIMIT 1
  `;
  const [rows] = await db.sequelize.query(q, {
    replacements: [phone],
  });
  return rows[0] || null;
};

const createConversation = async (phone) => {
  const q = `
    INSERT INTO ${tableNames.CONVERSATION}
    (phone, state, ai_enabled, assigned_to)
    VALUES (?, 'NEW', TRUE, NULL)
  `;
  await db.sequelize.query(q, {
    replacements: [phone],
  });
  return findConversationByPhoneService(phone);
};

const updateState = async (phone, state) => {
  if (state === "CHAT_MODE") {
    await updateAppSettingService("false", null, null, 1);
  }

  await db.sequelize.query(
    `UPDATE ${tableNames.CONVERSATION} SET state = ? WHERE phone = ?`,
    { replacements: [state, phone] }
  );
};

const setPending = async (phone, field, value) => {
  await db.sequelize.query(
    `UPDATE ${tableNames.CONVERSATION}
     SET pending_field = ?, pending_value = ?
     WHERE phone = ?`,
    { replacements: [field, value, phone] }
  );
};

const clearPending = async (phone) => {
  await db.sequelize.query(
    `UPDATE ${tableNames.CONVERSATION}
     SET pending_field = NULL,
         pending_value = NULL
     WHERE phone = ?`,
    { replacements: [phone] }
  );
};

const aiYesNo = async (text) => {
  const prompt = `
${PROFESSIONAL_SYSTEM_PROMPT}

User reply:
"${text}"

Question:
Is the user confirming YES or NO?

Reply with exactly one word:
YES or NO
`;
  const result = await findUserMessageService("system", prompt);
  return result.trim().toUpperCase() === "YES" ? "YES" : "NO";
};

const aiExtractName = async (text) => {
  const prompt = `
${PROFESSIONAL_SYSTEM_PROMPT}

Task:
Extract only the person's name from the sentence below.
If no clear name is present, reply with:
UNKNOWN

Sentence:
"${text}"
`;
  const result = await findUserMessageService("system", prompt);
  return result.trim();
};

const extractEmail = (text) => {
  const match = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0] : null;
};

export const processConversationService = async (phone, message) => {
  let conversation = await findConversationByPhoneService(phone);
  if (!conversation) {
    conversation = await createConversation(phone);
  }

  const { state, pending_field, pending_value } = conversation;

  if (pending_field && pending_value) {
    const decision = await aiYesNo(message);

    if (decision === "YES") {
      await addContactDetailService(phone, pending_field, pending_value);

      let nextState = "CHAT_MODE";
      let nextReply = "How can I assist you further.";

      if (pending_field === "name") {
        nextState = "WAITING_EMAIL";
        nextReply = "Please share your email address.";
      } else if (pending_field === "email") {
        nextState = "WAITING_CLINIC";
        nextReply = "Please share your clinic name.";
      }

      await clearPending(phone);
      await updateState(phone, nextState);
      return nextReply;
    }

    await clearPending(phone);
    return `Please provide the correct ${pending_field}.`;
  }

  if (state === "NEW") {
    await updateState(phone, "WAITING_NAME");
    return "Please share your full name.";
  }

  if (state === "WAITING_NAME") {
    const name = await aiExtractName(message);
    if (name === "UNKNOWN") {
      return "Please provide a valid name.";
    }
    await setPending(phone, "name", name);
    return `Please confirm. Is your name ${name}. Reply YES or NO.`;
  }

  if (state === "WAITING_EMAIL") {
    const email = extractEmail(message);
    if (!email) {
      return "Please provide a valid email address.";
    }
    await setPending(phone, "email", email);
    return `Please confirm. Is your email ${email}. Reply YES or NO.`;
  }

  if (state === "WAITING_CLINIC") {
    await setPending(phone, "clinic_name", message);
    return `Please confirm. Is your clinic name ${message}. Reply YES or NO.`;
  }

  return;
};
