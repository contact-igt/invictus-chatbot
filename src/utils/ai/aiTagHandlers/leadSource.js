import { getLeadByContactIdService, updateLeadStatusService } from "../../../models/LeadsModel/leads.service.js";

// Valid source values matching the ENUM in LeadsTable
const VALID_SOURCES = [
    "whatsapp", "meta", "website", "google", "referral",
    "instagram", "facebook", "twitter", "campaign", "post", "other"
];

/**
 * Handler for [LEAD_SOURCE: xxx] tag.
 * Auto-updates the lead source when AI detects how the user found the business.
 * Only updates if the current source is "none" (not yet identified).
 */
export const execute = async (payload, context) => {
    const { tenant_id, contact_id } = context;

    if (!payload || !tenant_id || !contact_id) {
        console.log("[LEAD_SOURCE] Missing payload or context, skipping.");
        return;
    }

    const detectedSource = payload.trim().toLowerCase();

    if (!VALID_SOURCES.includes(detectedSource)) {
        console.log(`[LEAD_SOURCE] Invalid source "${detectedSource}", skipping.`);
        return;
    }

    try {
        // Only update if current source is "none"
        const lead = await getLeadByContactIdService(tenant_id, contact_id);

        if (!lead) {
            console.log("[LEAD_SOURCE] No lead found for contact, skipping.");
            return;
        }

        if (lead.source !== "none") {
            console.log(`[LEAD_SOURCE] Lead already has source "${lead.source}", skipping.`);
            return;
        }

        await updateLeadStatusService(
            tenant_id,
            lead.lead_id,
            null,       // status
            null,       // heat_state
            null,       // lead_stage
            null,       // assigned_to
            null,       // priority
            detectedSource, // source
            null        // internal_notes
        );

        console.log(`[LEAD_SOURCE] Updated lead ${lead.lead_id} source to "${detectedSource}"`);
    } catch (error) {
        console.error("[LEAD_SOURCE] Error updating lead source:", error.message);
    }
};
