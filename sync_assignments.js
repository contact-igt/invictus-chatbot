import db from "./src/database/index.js";
import { tableNames } from "./src/database/tableName.js";

/**
 * One-time migration: sync all lead assignments → live_chats
 * For every lead that has an assigned_to value, set the matching
 * live_chat record's assigned_admin_id to the same value.
 */
async function syncExistingAssignments() {
  try {
    console.log("🔄 Syncing existing lead assignments to live_chats...\n");

    // Fetch all assigned leads
    const [leads] = await db.sequelize.query(`
      SELECT led.lead_id, led.contact_id, led.assigned_to, led.tenant_id, cta.name
      FROM ${tableNames.LEADS} led
      JOIN ${tableNames.CONTACTS} cta ON led.contact_id = cta.contact_id
      WHERE led.is_deleted = false AND led.assigned_to IS NOT NULL
    `);

    console.log(`Found ${leads.length} assigned lead(s) to sync.\n`);

    for (const lead of leads) {
      // Check current live_chat state
      const [liveChat] = await db.sequelize.query(`
        SELECT assigned_admin_id FROM ${tableNames.LIVECHAT}
        WHERE tenant_id = ? AND contact_id = ?
      `, { replacements: [lead.tenant_id, lead.contact_id] });

      const currentAdminId = liveChat[0]?.assigned_admin_id || null;

      if (currentAdminId !== lead.assigned_to) {
        await db.sequelize.query(`
          UPDATE ${tableNames.LIVECHAT}
          SET assigned_admin_id = ?
          WHERE tenant_id = ? AND contact_id = ?
        `, { replacements: [lead.assigned_to, lead.tenant_id, lead.contact_id] });

        console.log(`✅ ${lead.name}: live_chat updated  ${currentAdminId || 'null'} → ${lead.assigned_to}`);
      } else {
        console.log(`⏭️  ${lead.name}: already in sync (${currentAdminId})`);
      }
    }

    console.log("\n✅ Sync complete!");
    process.exit(0);
  } catch (err) {
    console.error("❌ Error:", err);
    process.exit(1);
  }
}

syncExistingAssignments();
