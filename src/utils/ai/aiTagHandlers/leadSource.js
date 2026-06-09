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
        
        return;
    }
    

    const detectedSource = payload.trim().toLowerCase();

    if (!VALID_SOURCES.includes(detectedSource)) {
        