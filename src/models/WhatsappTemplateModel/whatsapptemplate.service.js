import db from "../../database/index.js";
import { tableNames } from "../../database/tableName.js";
import axios from "axios";
import { getWhatsappAccountByTenantService } from "../WhatsappAccountModel/whatsappAccount.service.js";
import { generateReadableIdFromLast } from "../../utils/generateReadableIdFromLast.js";


const STATUS_MAP = {
  IN_REVIEW: "pending",
  PENDING: "pending",
  APPROVED: "approved",
  REJECTED: "rejected",
  PAUSED: "paused",
  DISABLED: "disabled",
};

export const checkTemplateNameExistsOnMetaService = async (
  tenant_id,
  template_name,
) => {
  try {
    const whatsappAccount = await getWhatsappAccountByTenantService(tenant_id);
    if (!whatsappAccount || whatsappAccount.status !== "active") {
      // If no active account, we can't check Meta, so we allow local creation (it will fail submission later if needed)
      return false;
    }

    const response = await axios.get(
      `https://graph.facebook.com/v23.0/${whatsappAccount.waba_id}/message_templates`,
      {
        params: {
          name: template_name,
          limit: 1,
        },
        headers: {
          Authorization: `Bearer ${whatsappAccount.access_token}`,
        },
      },
    );

    // Meta returns data array. If non-empty, template exists.
    return response.data.data && response.data.data.length > 0;
  } catch (err) {
    // If it's a 404 or specific error saying template not found, return false
    if (err.response?.status === 404) return false;
    console.error("Meta template name check error:", err.message);
    // On other errors, we might want to throw or allow local creation. 
    // Usually safest to throw if the check itself failed (e.g. auth issue).
    throw new Error(`Failed to check template name on Meta: ${err.message}`);
  }
};

export const createWhatsappTemplateService = async (
  template_id,
  tenant_id,
  template_name,
  category,
  language,
  components,
  variables,
  created_by,
) => {
  const transaction = await db.sequelize.transaction();

  try {
    const bodyText = components.body.text.trim();

    if (/^{{\d+}}/.test(bodyText)) {
      throw new Error("Body cannot start with a variable");
    }

    if (/{{\d+}}[.!?,]*$/.test(bodyText)) {
      throw new Error("Body cannot end with a variable");
    }

    await db.sequelize.query(
      `
      INSERT INTO ${tableNames.WHATSAPP_TEMPLATE}
      (template_id, tenant_id, template_name, category, language, created_by)
      VALUES (?, ?, ?, ?, ?, ?)
      `,
      {
        replacements: [
          template_id,
          tenant_id,
          template_name,
          category,
          language,
          created_by,
        ],
        transaction,
      },
    );

    await db.sequelize.query(
      `
      INSERT INTO ${tableNames.WHATSAPP_TEMPLATE_COMPONENTS}
      (template_id, component_type, text_content)
      VALUES (?, 'body', ?)
      `,
      {
        replacements: [template_id, components.body.text],
        transaction,
      },
    );

    if (components.header) {
      const { type, text, media_url } = components.header;

      if (!type) {
        throw new Error("Header type is required");
      }

      await db.sequelize.query(
        `
    INSERT INTO ${tableNames.WHATSAPP_TEMPLATE_COMPONENTS}
    (template_id, component_type, header_format, text_content, media_url)
    VALUES (?, 'header', ?, ?, ?)
    `,
        {
          replacements: [
            template_id,
            type, // header_format
            text ? text : null, // header text (only if type=text)
            media_url ? media_url : null, // media only for image/video/doc
          ],
          transaction,
        },
      );
    }

    if (components.footer?.text) {
      await db.sequelize.query(
        `
        INSERT INTO ${tableNames.WHATSAPP_TEMPLATE_COMPONENTS}
        (template_id, component_type, text_content)
        VALUES (?, 'footer', ?)
        `,
        {
          replacements: [template_id, components.footer.text],
          transaction,
        },
      );
    }

    for (const variable of variables) {
      await db.sequelize.query(
        `
        INSERT INTO ${tableNames.WHATSAPP_TEMPLATE_VARIABLES}
        (template_id, variable_key, sample_value)
        VALUES (?, ?, ?)
        `,
        {
          replacements: [template_id, variable.key, variable.sample],
          transaction,
        },
      );
    }

    await transaction.commit();
    return true;
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
};

export const submitWhatsappTemplateService = async ({
  template,
  components,
  variables,
  whatsappAccount,
}) => {
  const transaction = await db.sequelize.transaction();

  try {
    // ─────────────────────────────────────────
    // BODY validation (mandatory)
    // ─────────────────────────────────────────
    const body = components.find((c) => c.component_type === "body");
    if (!body || !body.text_content) {
      throw new Error("BODY component is required");
    }

    let bodyText = body.text_content.trim();

    // Meta rule: no leading/trailing variable
    if (/^{{\d+}}/.test(bodyText)) {
      throw new Error("Template body cannot start with a variable");
    }

    if (/{{\d+}}[.!?,]*$/.test(bodyText)) {
      // auto-fix to be Meta-safe
      bodyText = bodyText.replace(/({{\d+}})[.!?,]*$/, "$1 time");
    }

    // ─────────────────────────────────────────
    // Build Meta components
    // ─────────────────────────────────────────
    const metaComponents = [];

    // HEADER (optional)
    const header = components.find((c) => c.component_type === "header");
    if (header) {
      const headerObj = {
        type: "HEADER",
        format: (header.header_format || "text").toUpperCase(),
        text: header.text_content,
      };

      // If text header has variables, we need examples
      if (headerObj.format === "TEXT" && header.text_content?.includes("{{1}}")) {
        const headerVar = variables.find(v => v.variable_key === "1" || v.variable_key === "header_1");
        if (headerVar) {
          headerObj.example = { header_text: [headerVar.sample_value] };
        }
      }
      metaComponents.push(headerObj);
    }

    // BODY
    const sortedVariables = variables
      .sort((a, b) => a.variable_key.localeCompare(b.variable_key))
      .map((v) => v.sample_value);

    // Calculate total placeholders across all components
    let totalPlaceholderCount = (bodyText.match(/{{\d+}}/g) || []).length;
    if (header && header.header_format === "text" && header.text_content) {
      totalPlaceholderCount += (header.text_content.match(/{{\d+}}/g) || []).length;
    }

    if (totalPlaceholderCount !== sortedVariables.length) {
      throw new Error(`Variable count mismatch: expected ${totalPlaceholderCount} but got ${sortedVariables.length}`);
    }

    metaComponents.push({
      type: "BODY",
      text: bodyText,
      example: {
        body_text: [sortedVariables],
      },
    });

    // FOOTER (optional)
    const footer = components.find((c) => c.component_type === "footer");
    if (footer) {
      metaComponents.push({
        type: "FOOTER",
        text: footer.text_content,
      });
    }

    // ─────────────────────────────────────────
    // Final Meta payload
    // ─────────────────────────────────────────
    const payload = {
      name: template.template_name,
      language: template.language,
      category: template.category.toUpperCase(),
      parameter_format: "positional",
      components: metaComponents,
    };

    // ─────────────────────────────────────────
    // Submit to Meta
    // ─────────────────────────────────────────
    const response = await axios.post(
      `https://graph.facebook.com/v23.0/${whatsappAccount.waba_id}/message_templates`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${whatsappAccount.access_token}`,
          "Content-Type": "application/json",
        },
      },
    );

    const metaTemplateId = response.data.id;
    const metaStatus = response.data.status || "IN_REVIEW";

    // ─────────────────────────────────────────
    // Update template
    // ─────────────────────────────────────────
    await db.sequelize.query(
      `
      UPDATE ${tableNames.WHATSAPP_TEMPLATE}
      SET meta_template_id = ?, status = 'pending'
      WHERE template_id = ? AND is_deleted = false
      `,
      {
        replacements: [metaTemplateId, template.template_id],
        transaction,
      },
    );

    // ─────────────────────────────────────────
    // Sync log
    // ─────────────────────────────────────────
    await db.sequelize.query(
      `
      INSERT INTO ${tableNames.WHATSAPP_TEMPLATE_SYNC_LOGS}
      (template_id, action, request_payload, response_payload, meta_status)
      VALUES (?, 'submit', ?, ?, ?)
      `,
      {
        replacements: [
          template.template_id,
          JSON.stringify(payload),
          JSON.stringify(response.data),
          "pending",
        ],
        transaction,
      },
    );

    await transaction.commit();

    return {
      meta_template_id: metaTemplateId,
      meta_status: metaStatus,
    };
  } catch (err) {
    await transaction.rollback();

    const metaMsg =
      err.response?.data?.error?.error_user_msg ||
      err.response?.data?.error?.message ||
      err.message;

    throw new Error(`Template submission failed: ${metaMsg}`);
  }
};

export const syncWhatsappTemplateStatusService = async ({
  template,
  whatsappAccount,
}) => {
  const transaction = await db.sequelize.transaction();

  try {
    if (!template.meta_template_id) {
      throw new Error("Template not submitted to Meta");
    }

    // ✅ Meta API (ONLY status is supported)
    const metaRes = await axios.get(
      `https://graph.facebook.com/v23.0/${template.meta_template_id}`,
      {
        params: { fields: "status" },
        headers: {
          Authorization: `Bearer ${whatsappAccount.access_token}`,
        },
      },
    );

    const metaStatus = metaRes.data.status;
    const mappedStatus = STATUS_MAP[metaStatus] || "pending";

    // Update main table
    await db.sequelize.query(
      `
      UPDATE ${tableNames.WHATSAPP_TEMPLATE}
      SET status = ?
      WHERE template_id = ? AND is_deleted = false
      `,
      {
        replacements: [mappedStatus, template.template_id],
        transaction,
      },
    );

    // Insert sync log
    await db.sequelize.query(
      `
      INSERT INTO ${tableNames.WHATSAPP_TEMPLATE_SYNC_LOGS}
      (template_id, action, response_payload, meta_status)
      VALUES (?, 'sync', ?, ?)
      `,
      {
        replacements: [
          template.template_id,
          JSON.stringify(metaRes.data),
          mappedStatus,
        ],
        transaction,
      },
    );

    await transaction.commit();

    return {
      status: mappedStatus,
      meta_status: metaStatus,
    };
  } catch (err) {
    await transaction.rollback();

    const metaMsg =
      err.response?.data?.error?.message ||
      err.response?.data?.error?.error_user_msg ||
      err.message;

    throw new Error(`Template sync failed: ${metaMsg}`);
  }
};

export const syncAllPendingTemplatesService = async (
  tenant_id,
  whatsappAccount,
) => {
  const [templates] = await db.sequelize.query(
    `
    SELECT * FROM ${tableNames.WHATSAPP_TEMPLATE}
    WHERE tenant_id = ?
      AND status = 'pending'
      AND meta_template_id IS NOT NULL
      AND is_deleted = false
    `,
    { replacements: [tenant_id] },
  );

  const results = [];

  for (const template of templates) {
    try {
      const result = await syncWhatsappTemplateStatusService({
        template,
        whatsappAccount,
      });

      results.push({
        template_id: template.template_id,
        status: result.status,
      });
    } catch (err) {
      results.push({
        template_id: template.template_id,
        error: err.message,
      });
    }
  }

  return results;
};
// ... existing code ...

export const getTemplateListService = async (tenant_id) => {
  const [templates] = await db.sequelize.query(
    `
    SELECT * FROM ${tableNames.WHATSAPP_TEMPLATE}
    WHERE tenant_id = ? AND is_deleted = false
    ORDER BY created_at DESC
    `,
    { replacements: [tenant_id] },
  );

  return templates.map((t) => ({
    ...t,
    is_submitted: !!t.meta_template_id,
    can_edit: ["draft", "rejected"].includes(t.status),
    can_submit: t.status === "draft",
    display_status: t.status.charAt(0).toUpperCase() + t.status.slice(1),
  }));
};

export const getTemplateByIdService = async (template_id, tenant_id) => {
  // Join all related data
  const [[template]] = await db.sequelize.query(
    `SELECT * FROM ${tableNames.WHATSAPP_TEMPLATE} WHERE template_id = ? AND tenant_id = ? AND is_deleted = false`,
    { replacements: [template_id, tenant_id] },
  );

  if (!template) return null;

  const [components] = await db.sequelize.query(
    `SELECT * FROM ${tableNames.WHATSAPP_TEMPLATE_COMPONENTS} WHERE template_id = ?`,
    { replacements: [template_id] },
  );

  const [variables] = await db.sequelize.query(
    `SELECT * FROM ${tableNames.WHATSAPP_TEMPLATE_VARIABLES} WHERE template_id = ? ORDER BY variable_key ASC`,
    { replacements: [template_id] },
  );

  const [logs] = await db.sequelize.query(
    `SELECT * FROM ${tableNames.WHATSAPP_TEMPLATE_SYNC_LOGS} WHERE template_id = ? ORDER BY created_at DESC LIMIT 20`,
    { replacements: [template_id] },
  );

  return {
    ...template,
    is_submitted: !!template.meta_template_id,
    can_edit: ["draft", "rejected"].includes(template.status),
    can_submit: template.status === "draft",
    display_status: template.status.charAt(0).toUpperCase() + template.status.slice(1),
    components,
    variables,
    logs,
  };
};

export const pullTemplatesFromMetaService = async (tenant_id) => {
  const transaction = await db.sequelize.transaction();
  try {
    const whatsappAccount = await getWhatsappAccountByTenantService(tenant_id);
    if (!whatsappAccount || whatsappAccount.status !== "active") {
      throw new Error("Active WhatsApp account required to sync templates");
    }

    // 1. Fetch templates from Meta
    let allTemplates = [];
    let nextUrl = `https://graph.facebook.com/v23.0/${whatsappAccount.waba_id}/message_templates?fields=id,name,status,category,language,components&limit=100`;

    // Pagination loop
    while (nextUrl) {
      const response = await axios.get(nextUrl, {
        headers: { Authorization: `Bearer ${whatsappAccount.access_token}` },
      });
      if (response.data.data) {
        allTemplates.push(...response.data.data);
      }
      nextUrl = response.data.paging?.next || null;
    }

    const syncedCount = { created: 0, updated: 0 };

    for (const metaT of allTemplates) {
      // Map status
      const localStatus = STATUS_MAP[metaT.status] || "pending";

      // Check if exists (including soft-deleted)
      const [[existing]] = await db.sequelize.query(
        `SELECT * FROM ${tableNames.WHATSAPP_TEMPLATE} WHERE (meta_template_id = ? OR (tenant_id = ? AND template_name = ?))`,
        { replacements: [metaT.id, tenant_id, metaT.name], transaction }
      );

      if (existing) {
        // If it was soft-deleted, we skip it to honor local deletion
        if (existing.is_deleted) {
          continue;
        }

        // Update status if changed
        if (existing.status !== localStatus || !existing.meta_template_id) {
          await db.sequelize.query(
            `UPDATE ${tableNames.WHATSAPP_TEMPLATE} SET status = ?, meta_template_id = ? WHERE template_id = ?`,
            { replacements: [localStatus, metaT.id, existing.template_id], transaction }
          );
          syncedCount.updated++;
        }
      } else {
        // Import new template
        const template_id = await generateReadableIdFromLast(tableNames.WHATSAPP_TEMPLATE, "template_id", "WT");

        await db.sequelize.query(
          `INSERT INTO ${tableNames.WHATSAPP_TEMPLATE} 
           (template_id, tenant_id, template_name, category, language, status, meta_template_id, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          {
            replacements: [
              template_id,
              tenant_id,
              metaT.name,
              metaT.category.toLowerCase(),
              metaT.language,
              localStatus,
              metaT.id,
              "system" // Imported
            ],
            transaction
          }
        );

        // Import components
        for (const comp of metaT.components) {
          let text = comp.text || null;
          let format = comp.format ? comp.format.toLowerCase() : null;
          let type = comp.type.toLowerCase();

          if (type === 'body' || type === 'footer' || type === 'header') {
            await db.sequelize.query(
              `INSERT INTO ${tableNames.WHATSAPP_TEMPLATE_COMPONENTS}
                (template_id, component_type, header_format, text_content)
                VALUES (?, ?, ?, ?)`,
              {
                replacements: [template_id, type, format, text],
                transaction
              }
            );

            // Extract variables from body or text header
            if ((type === 'body' || (type === 'header' && format === 'text')) && text) {
              const matches = text.match(/{{\d+}}/g);
              if (matches) {
                const uniqueVars = [...new Set(matches)];
                for (const vKey of uniqueVars) {
                  // Only insert if not already present for this template (in case same var key in header and body)
                  const [[existingVar]] = await db.sequelize.query(
                    `SELECT * FROM ${tableNames.WHATSAPP_TEMPLATE_VARIABLES} WHERE template_id = ? AND variable_key = ?`,
                    { replacements: [template_id, vKey.replace(/[{}]/g, '')], transaction }
                  );

                  if (!existingVar) {
                    await db.sequelize.query(
                      `INSERT INTO ${tableNames.WHATSAPP_TEMPLATE_VARIABLES}
                        (template_id, variable_key, sample_value)
                        VALUES (?, ?, ?)`,
                      {
                        replacements: [template_id, vKey.replace(/[{}]/g, ''), 'Sample Data'],
                        transaction
                      }
                    );
                  }
                }
              }
            }
          }
        }
        syncedCount.created++;
      }
    }

    await transaction.commit();
    return syncedCount;

  } catch (err) {
    await transaction.rollback();
    throw new Error(`Pull from Meta failed: ${err.message}`);
  }
};

export const softDeleteTemplateService = async (template_id, tenant_id) => {
  const transaction = await db.sequelize.transaction();
  try {
    const [[template]] = await db.sequelize.query(
      `SELECT * FROM ${tableNames.WHATSAPP_TEMPLATE} WHERE template_id = ? AND tenant_id = ? AND is_deleted = false`,
      {
        replacements: [template_id, tenant_id],
        transaction,
      },
    );

    if (!template) {
      throw new Error("Template not found or already deleted");
    }

    await db.sequelize.query(
      `UPDATE ${tableNames.WHATSAPP_TEMPLATE} SET is_deleted = true, deleted_at = NOW() WHERE template_id = ?`,
      {
        replacements: [template_id],
        transaction,
      },
    );

    await transaction.commit();
    return true;
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
};

export const permanentDeleteTemplateService = async (template_id, tenant_id) => {
  const transaction = await db.sequelize.transaction();
  try {
    const whatsappAccount = await getWhatsappAccountByTenantService(tenant_id);

    const [[template]] = await db.sequelize.query(
      `SELECT * FROM ${tableNames.WHATSAPP_TEMPLATE} WHERE template_id = ? AND tenant_id = ?`,
      {
        replacements: [template_id, tenant_id],
        transaction,
      },
    );

    if (!template) {
      throw new Error("Template not found");
    }

    // Deletion from Meta is mandatory for permanent delete
    if (!whatsappAccount || whatsappAccount.status !== "active") {
      throw new Error("Active WhatsApp account required for permanent deletion from Meta");
    }

    if (!template.template_name) {
      throw new Error("Template name is missing, cannot delete from Meta");
    }

    try {
      await axios.delete(
        `https://graph.facebook.com/v23.0/${whatsappAccount.waba_id}/message_templates`,
        {
          params: { name: template.template_name },
          headers: { Authorization: `Bearer ${whatsappAccount.access_token}` },
        }
      );
    } catch (metaErr) {
      // If 404, template doesn't exist on Meta, which is fine for us
      if (metaErr.response?.status !== 404) {
        const metaMsg = metaErr.response?.data?.error?.message || metaErr.message;
        throw new Error(`Failed to delete from Meta: ${metaMsg}`);
      }
    }

    // Delete from all related tables
    const tableReplacements = { replacements: [template_id], transaction };

    await db.sequelize.query(
      `DELETE FROM ${tableNames.WHATSAPP_TEMPLATE_COMPONENTS} WHERE template_id = ?`,
      tableReplacements
    );
    await db.sequelize.query(
      `DELETE FROM ${tableNames.WHATSAPP_TEMPLATE_VARIABLES} WHERE template_id = ?`,
      tableReplacements
    );
    await db.sequelize.query(
      `DELETE FROM ${tableNames.WHATSAPP_TEMPLATE_SYNC_LOGS} WHERE template_id = ?`,
      tableReplacements
    );
    await db.sequelize.query(
      `DELETE FROM ${tableNames.WHATSAPP_TEMPLATE} WHERE template_id = ?`,
      tableReplacements
    );

    await transaction.commit();
    return true;
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
};
