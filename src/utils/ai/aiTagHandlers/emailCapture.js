import db from "../../../database/index.js";
import { tableNames } from "../../../database/tableName.js";

/**
 * Simple email format check (not exhaustive — just prevents saving garbage).
 */
const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

/**
 * Handler for [EMAIL_CAPTURE: xxx@yyy.zzz] tag.
 * Auto-saves the user's email to the contact record.
 * Only updates if the contact currently has no email on file.
 */
export const execute = async (payload, context) => {
  const { tenant_id, contact_id } = context;

  if (!payload || !tenant_id || !contact_id) {
    
    return;
  }

  const email = payload.trim().toLowerCase();

  if (!isValidEmail(email)) {
    