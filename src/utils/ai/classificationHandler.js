import db from "../../database/index.js";

/**
 * Handles the logic after a response has been classified.
 * Creates logs in the ai_analysis_logs table based on the classification.
 * 
 * @param {string} classification - The category (MISSING_KNOWLEDGE, URGENT, etc.)
 * @param {object} context - { tenant_id, userMessage, aiResponse }
 */
export const handleClassification = async (result, context) => {
    const { category, reason } = result;
    const { tenant_id, userMessage, aiResponse } = context;

    // Map classifier categories to DB types (Case-insensitive matching)
    const typeMapping = {
        'missing_knowledge': 'missing_knowledge',
        'out_of_scope': 'out_of_scope',
        'urgent': 'urgent',
        'negative_sentiment': 'sentiment',
        'sentiment': 'sentiment'
    };

    const normalizedCategory = category?.toLowerCase();
    const logType = typeMapping[normalizedCategory];

    // We only log if it matches one of our mapped types
    if (!logType) {
        return;
    }

    try {
        // Determine status based on classification (Ensure lowercase)
        let status = 'pending';

        // If URGENT or NEGATIVE_SENTIMENT, mark as 'act_on' (High priority)
        if (normalizedCategory === 'urgent' || normalizedCategory === 'negative_sentiment' || normalizedCategory === 'sentiment') {
            status = 'act_on';
        }

        if (normalizedCategory === 'out_of_scope') {
            status = 'ignored';
        }

        await db.AiAnalysisLog.create({
            tenant_id,
            type: logType.toLowerCase(),
            payload: reason,
            user_message: userMessage,
            ai_response: aiResponse,
            status: status.toLowerCase()
        });

        console.log(`[AI-HANDLER] Logged ${logType} for tenant ${tenant_id} (Status: ${status}, Reason: ${reason})`);
    } catch (error) {
        console.error("[AI-HANDLER] Error logging classification:", error);
    }
};

