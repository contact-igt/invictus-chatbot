/**
 * Debug helper for the Repeated User Message → AI Handoff feature.
 *
 *   node scripts/repeatHandoffDebug.js status
 *   node scripts/repeatHandoffDebug.js tenant 9361824559
 *   node scripts/repeatHandoffDebug.js contact 9361824559
 *   node scripts/repeatHandoffDebug.js reset 9361824559
 */
import db from "../src/database/index.js";
import { isRepeatedMessageHandoffEnabled } from "../src/config/repeatedMessageHandoff.config.js";

const [cmd, arg] = process.argv.slice(2);
// contacts store the last 10 digits (country code is split off on insert)
const digits = arg ? String(arg).replace(/\D/g, "") : "";
const suffix = digits.length > 10 ? digits.slice(-10) : digits;
const like = arg ? `%${suffix}%` : "%";

const run = async () => {
  if (cmd === "status") {
    const [cols] = await db.sequelize.query(
      "SHOW COLUMNS FROM contacts LIKE 'ai_reply_epoch'",
    );
    const [tbl] = await db.sequelize.query("SHOW TABLES LIKE 'ai_handoff_events'");
    console.log("migration columns :", cols.length ? "OK" : "MISSING — run the migration");
    console.log("ai_handoff_events :", tbl.length ? "OK" : "MISSING — run the migration");
    console.log("flag env          :", {
      REPEATED_MESSAGE_HANDOFF_ENABLED: process.env.REPEATED_MESSAGE_HANDOFF_ENABLED || null,
      REPEATED_MESSAGE_HANDOFF_TENANTS: process.env.REPEATED_MESSAGE_HANDOFF_TENANTS || null,
    });
  } else if (cmd === "tenant") {
    const [rows] = await db.sequelize.query("SELECT * FROM whatsapp_accounts");
    const hit = rows.filter((r) =>
      JSON.stringify(r).replace(/\D/g, "").includes(String(arg).replace(/\D/g, "")),
    );
    console.log(hit.length ? hit : rows);
    for (const r of hit.length ? hit : rows) {
      console.log(
        `tenant ${r.tenant_id} -> flag enabled: ${isRepeatedMessageHandoffEnabled(r.tenant_id)}`,
      );
    }
  } else if (cmd === "contact") {
    const [rows] = await db.sequelize.query(
      `SELECT contact_id, tenant_id, phone, is_ai_silenced, ai_pause_reason, ai_paused_at,
              ai_reply_epoch, repeat_message_hash, repeat_message_count, repeat_last_received_at
         FROM contacts WHERE phone LIKE ?`,
      { replacements: [like] },
    );
    console.log(rows);
    const [ev] = await db.sequelize.query(
      `SELECT * FROM ai_handoff_events WHERE contact_id IN
         (SELECT contact_id FROM contacts WHERE phone LIKE ?) ORDER BY id DESC`,
      { replacements: [like] },
    );
    console.log("handoff events:", ev);
  } else if (cmd === "reset") {
    await db.sequelize.query(
      `UPDATE contacts SET is_ai_silenced = 0, ai_pause_reason = NULL, ai_paused_at = NULL,
              repeat_message_hash = NULL, repeat_message_count = 0, repeat_last_received_at = NULL
         WHERE phone LIKE ?`,
      { replacements: [like] },
    );
    await db.sequelize.query(
      `DELETE FROM ai_handoff_events WHERE contact_id IN
         (SELECT contact_id FROM contacts WHERE phone LIKE ?)`,
      { replacements: [like] },
    );
    console.log("reset done for phone LIKE", like);
  } else if (cmd === "webhook") {
    const [accts] = await db.sequelize.query("SELECT * FROM whatsapp_accounts");
    console.log("=== whatsapp_accounts ===");
    console.log(accts);
    const [tns] = await db.sequelize.query("SELECT * FROM tenants");
    console.log("=== tenants ===");
    for (const t of tns) {
      console.log({
        tenant_id: t.tenant_id,
        verify_token: t.verify_token,
        webhook_path: `/api/whatsapp/webhook/${t.tenant_id}`,
      });
    }
  } else if (cmd === "recent") {
    const [dbn] = await db.sequelize.query("SELECT DATABASE() AS db");
    console.log("connected DB:", dbn[0].db);
    const [rows] = await db.sequelize.query(
      `SELECT contact_id, tenant_id, country_code, phone, name, is_ai_silenced, ai_pause_reason
         FROM contacts ORDER BY id DESC LIMIT 20`,
    );
    console.log(rows);
  } else {
    console.log("usage: status | tenant <phone> | contact <phone> | reset <phone> | recent");
  }
  await db.sequelize.close();
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
