import db from "../../../database/index.js";

// Handler for MISSING_KNOWLEDGE tag
export const execute = async (payload, context, cleanMessage) => {
    const { tenant_id, userMessage } = context;

    try {
        await db.AiAnalysisLog.create({
            tenant_id,
            type: "missing_knowledge",
            payload: payload ? payload.trim() : "No reason provided",
            user_message: userMessage,
            ai_response: cleanMessage,
            status: "pending",
        });
        console.log(`[AI-LOG] Missing Knowledge logged for tenant ${tenant_id}`);
    } catch (error) {
        console.error("[AI-LOG] Error logging Missing Knowledge:", error);
    }
};
