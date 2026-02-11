import db from "../../../database/index.js";

// Handler for OUT_OF_SCOPE tag
export const execute = async (payload, context, cleanMessage) => {
    const { tenant_id, userMessage } = context;

    try {
        // We log it as 'ignored' so it doesn't clutter the main "To Do" list,
        // but we keep it for analytics to see what users are asking about.
        await db.AiAnalysisLog.create({
            tenant_id,
            type: "out_of_scope",
            payload: payload ? payload.trim() : "No reason provided",
            user_message: userMessage,
            ai_response: cleanMessage,
            status: "ignored",
        });
        console.log(`[AI-LOG] Out of Scope logged for tenant ${tenant_id}`);
    } catch (error) {
        console.error("[AI-LOG] Error logging Out of Scope:", error);
    }
};
