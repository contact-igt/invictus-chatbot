import axios from "axios";
// import Groq from "groq-sdk";
import OpenAI from "openai";
import { searchKnowledgeChunks } from "../Knowledge/knowledge.search.js";
import { getConversationMemory } from "../Messages/messages.memory.js";
import { detectLanguageStyle } from "../../utils/detectLanguageStyle.js";
import { buildChatHistory } from "../../utils/buildChatHistory.js";
import { getActivePromptService } from "../AiPrompt/aiprompt.service.js";

// const groq = new Groq({
//   apiKey: process.env.GROQ_API_KEY,
// });

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export const sendWhatsAppMessage = async (to, message, replyToMessageId) => {
  const payload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "text",
    text: { body: message },
  };

  // 🔥 Reply to specific message
  if (replyToMessageId) {
    payload.context = {
      message_id: replyToMessageId,
    };
  }

  await axios.post(
    `https://graph.facebook.com/${process.env.META_API_VERSION}/${process.env.META_PHONE_NUMBER_ID}/messages`,
    payload,
    {
      headers: {
        Authorization: `Bearer ${process.env.META_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
    }
  );
};

// export const getGroqReply = async (phone, userMessage) => {
//   try {
//     if (!userMessage || !userMessage.trim()) {
//       return "Hello. How can I assist you today?";
//     }

//     // 1️⃣ Load recent conversation memory
//     const memory = await getConversationMemory(phone, 6);
//     const chatHistory = buildChatHistory(memory);

//     // 2️⃣ Search knowledge base
//     const chunks = await searchKnowledgeChunks(userMessage);
//     const context = chunks.join("\n\n");

//     // 3️⃣ System prompt (professional & controlled)
//     const systemPrompt = `
// You are a professional WhatsApp support assistant.

// INSTRUCTIONS:
// - Reply in the same language and typing style as the user.
// - Use conversation history to understand follow-up questions.
// - Use the knowledge section below to answer factual questions.
// - If the information is not available, respond politely that you do not have that information.
// - Do not speculate or invent details.
// - Keep responses clear, concise, and professional.

// KNOWLEDGE BASE:
// ${context || "No relevant knowledge available."}
// `;

//     // 4️⃣ Generate AI response
//     const completion = await groq.chat.completions.create({
//       model: "llama-3.1-8b-instant",
//       messages: [
//         { role: "system", content: systemPrompt },
//         ...chatHistory,
//         { role: "user", content: userMessage },
//       ],
//       temperature: 0.2,
//     });

//     return completion.choices[0].message.content.trim();
//   } catch (err) {
//     console.error("Groq AI error:", err.message);
//     return "We are unable to process your request at the moment. Please try again later.";
//   }
// };

// export const getGroqReply = async (phone, userMessage) => {
//   try {
//     if (!userMessage || !userMessage.trim()) {
//       return "Hello. How can I help you?";
//     }

//     const memory = await getConversationMemory(phone, 6);
//     const chatHistory = buildChatHistory(memory);

//     const chunks = await searchKnowledgeChunks(userMessage);
//     const context = chunks.join("\n\n");

//     const systemPrompt = `
// You are a professional WhatsApp assistant.

// LANGUAGE RULES:
// - Reply in the same language and typing style as the user.

// SPECIAL HANDOFF RULE (VERY IMPORTANT):
// - If the user asks about money, budget, fees, payment, price, cost, discount, offer, or refund:
//   → Do NOT provide details.
//   → Politely respond that the support team will assist.
//   → Keep the response short and professional.

// ANSWER LENGTH RULES:
// - List question → show full list.
// - Single item detail → short summary (2–3 lines).
// - General / follow-up → very short (1–2 lines).

// KNOWLEDGE RULES:
// - Use ONLY the knowledge below.
// - Do not guess or invent information.

// KNOWLEDGE:
// ${context || "No relevant knowledge available."}
// `;

//     const completion = await groq.chat.completions.create({
//       model: "llama-3.1-8b-instant",
//       messages: [
//         { role: "system", content: systemPrompt },
//         ...chatHistory,
//         { role: "user", content: userMessage },
//       ],
//       temperature: 0.1,
//       max_tokens: 180,
//     });

//     return completion.choices[0].message.content.trim();
//   } catch (err) {
//     console.error("Groq AI error:", err.message);
//     return "Please try again later.";
//   }
// };

export const getOpenAIReply = async (phone, userMessage) => {
  try {
    if (!userMessage || !userMessage.trim()) {
      return "Hello. How can I help you?";
    }

    const DEFAULT_SYSTEM_PROMPT = `You are a WhatsApp support assistant.Reply briefly.Use the same language and typing style as the user.Be polite, calm, and helpful.If the required information is not available, say so politely.`;

    // 1️⃣ Detect user style
    const style = detectLanguageStyle(userMessage);

    // 2️⃣ Load conversation memory
    const memory = await getConversationMemory(phone, 4);
    const chatHistory = buildChatHistory(memory);

    // 3️⃣ Get ACTIVE AI prompt from DB (or fallback)
    const activePromptText = await getActivePromptService();

    const basePrompt =
      activePromptText && activePromptText.trim().length
        ? activePromptText
        : DEFAULT_SYSTEM_PROMPT;

    const chunks = await searchKnowledgeChunks(userMessage);
    const context =
      chunks && chunks.length
        ? chunks.join("\n\n")
        : "No relevant knowledge available.";

    // 5️⃣ Build FINAL system prompt
    const systemPrompt = `
    ${basePrompt}

    UPLOADED KNOWLEDGE:
    ${context} `;

    // 6️⃣ OpenAI call
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        ...chatHistory,
        { role: "user", content: userMessage },
      ],
      temperature: 0.05,
      max_tokens: 120,
    });

    return response.choices[0].message.content.trim();
  } catch (err) {
    console.error("OpenAI error:", err.message);
    return "Please try again later.";
  }
};
