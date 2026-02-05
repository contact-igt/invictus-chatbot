import db from "../../database/index.js";
import { tableNames } from "../../database/tableName.js";
import axios from "axios";
import { AiService } from "../../utils/coreAi.js";
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
      const varKey = variable.key.replace(/[{}]/g, ""); // Strip braces for consistency
      await db.sequelize.query(
        `
        INSERT INTO ${tableNames.WHATSAPP_TEMPLATE_VARIABLES}
        (template_id, variable_key, sample_value)
        VALUES (?, ?, ?)
        `,
        {
          replacements: [template_id, varKey, variable.sample],
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
    // Validate variable density (Meta requirement)
    // ─────────────────────────────────────────
    // Meta requires stricter density: minimum 5 words per variable OR 15 total words
    const variableCount = (bodyText.match(/{{\d+}}/g) || []).length;
    const bodyWordCount = bodyText
      .replace(/{{\d+}}/g, "")
      .trim()
      .split(/\s+/)
      .filter((w) => w.length > 0).length;

    // Meta requires either:
    // 1. At least 5 words per variable, OR
    // 2. At least 15 total words
    const minWordsPerVariable = 5;
    const minTotalWords = 15;
    const minRequiredWords = variableCount * minWordsPerVariable;

    if (
      variableCount > 0 &&
      bodyWordCount < minRequiredWords &&
      bodyWordCount < minTotalWords
    ) {
      throw new Error(
        `Template text is too short. You have ${variableCount} variable(s) with only ${bodyWordCount} word(s). ` +
        `Meta requires either: (a) at least ${minWordsPerVariable} words per variable (${minRequiredWords} total for your template), OR ` +
        `(b) a minimum of ${minTotalWords} words total. ` +
        `Please add more descriptive text to your template.`,
      );
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
      if (
        headerObj.format === "TEXT" &&
        header.text_content?.includes("{{1}}")
      ) {
        const headerVar = variables.find(
          (v) => v.variable_key === "1" || v.variable_key === "header_1",
        );
        if (headerVar) {
          headerObj.example = { header_text: [headerVar.sample_value] };
        }
      }
      metaComponents.push(headerObj);
    }

    // BODY
    // Sort ALL variables numerically by their key (1, 2, 3, etc.)
    if (!variables || variables.length === 0) {
      console.error(
        "❌ No variables found for template:",
        template.template_id,
      );
    }

    const sortedVariables = (variables || [])
      .sort((a, b) => parseInt(a.variable_key) - parseInt(b.variable_key))
      .map((v) => v.sample_value);

    console.log("📊 Variables Debug:", {
      template_id: template.template_id,
      variables_count: (variables || []).length,
      sorted_variables_count: sortedVariables.length,
      sorted_variables: sortedVariables,
      variables_raw: variables,
    });

    // Calculate total placeholders across all components
    let totalPlaceholderCount = (bodyText.match(/{{\d+}}/g) || []).length;
    if (header && header.header_format === "text" && header.text_content) {
      totalPlaceholderCount += (header.text_content.match(/{{\d+}}/g) || [])
        .length;
    }

    // Also count variables in footer
    const footer = components.find((c) => c.component_type === "footer");
    if (footer && footer.text_content) {
      totalPlaceholderCount += (footer.text_content.match(/{{\d+}}/g) || [])
        .length;
    }

    if (totalPlaceholderCount !== variables.length) {
      throw new Error(
        `Variable count mismatch: expected ${totalPlaceholderCount} but got ${variables.length}`,
      );
    }

    // Extract only variables used in BODY text for the example field
    const bodyVariablesMatch = bodyText.match(/{{\d+}}/g) || [];
    const bodyVariableKeys = bodyVariablesMatch.map((match) =>
      parseInt(match.replace(/[{}]/g, "")),
    );
    const bodyVariablesExample = bodyVariableKeys.map(
      (key) => sortedVariables[key - 1],
    );

    console.log("📊 BODY Variables Example:", {
      bodyVariableKeys,
      bodyVariablesExample,
    });

    const bodyComponent = {
      type: "BODY",
      text: bodyText,
    };

    // ⚠️ Meta API requires examples for ALL variables in the body
    // Format must be an array of arrays: [[val1, val2, val3]]
    if (bodyVariablesExample.length > 0) {
      bodyComponent.example = {
        body_text: [bodyVariablesExample],
      };
      console.log(
        `✅ Added example for BODY with ${bodyVariablesExample.length} variable(s)`,
      );
    }

    metaComponents.push(bodyComponent);

    // FOOTER (optional)
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

    console.log(
      "🚀 Meta Payload being sent:",
      JSON.stringify(payload, null, 2),
    );

    console.log("📋 BODY Component Details:", {
      bodyComponent: metaComponents.find((c) => c.type === "BODY"),
      bodyComponentString: JSON.stringify(
        metaComponents.find((c) => c.type === "BODY"),
      ),
    });

    // Debug: Validate payload structure
    console.log("🔍 Payload Structure Validation:", {
      hasComponents: !!payload.components,
      componentCount: payload.components?.length,
      bodyComponentIndex: payload.components?.findIndex(
        (c) => c.type === "BODY",
      ),
      bodyComponentHasExample: !!payload.components?.find(
        (c) => c.type === "BODY",
      )?.example,
    });

    // ─────────────────────────────────────────
    // Submit to Meta
    // ─────────────────────────────────────────
    let response;
    try {
      console.log("🔐 Meta Account Details:", {
        waba_id: whatsappAccount?.waba_id,
        access_token_exists: !!whatsappAccount?.access_token,
        access_token_length: whatsappAccount?.access_token?.length,
        access_token_first_20: whatsappAccount?.access_token?.substring(0, 20),
      });

      response = await axios.post(
        `https://graph.facebook.com/v24.0/${whatsappAccount.waba_id}/message_templates`,
        payload,
        {
          headers: {
            Authorization: `Bearer ${whatsappAccount.access_token}`,
            "Content-Type": "application/json",
          },
        },
      );
    } catch (metaErr) {
      console.error("❌ Meta API Error Response:", {
        status: metaErr.response?.status,
        data: metaErr.response?.data,
        headers: metaErr.response?.headers,
      });
      throw metaErr;
    }

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

    // Enhance error object with Meta details for the controller to handle
    const error = new Error(`Template submission failed: ${metaMsg}`);
    if (err.response?.data?.error) {
      error.metaError = err.response.data.error;
    }
    throw error;
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

  // Fetch components and variables for ALL templates efficiently
  // Note: For large datasets, this might be slow. Consider pagination or separate lookups if needed.
  // But for typical template list sizes (10-100), this is fine.

  const templateIds = templates.map(t => t.template_id);

  let allComponents = [];
  let allVariables = [];

  if (templateIds.length > 0) {
    [allComponents] = await db.sequelize.query(
      `SELECT * FROM ${tableNames.WHATSAPP_TEMPLATE_COMPONENTS} WHERE template_id IN (?)`,
      { replacements: [templateIds] }
    );

    [allVariables] = await db.sequelize.query(
      `SELECT * FROM ${tableNames.WHATSAPP_TEMPLATE_VARIABLES} WHERE template_id IN (?) ORDER BY variable_key ASC`,
      { replacements: [templateIds] }
    );
  }

  return templates.map((t) => {
    const components = allComponents.filter(c => c.template_id === t.template_id);
    const variables = allVariables.filter(v => v.template_id === t.template_id);

    return {
      ...t,
      is_submitted: !!t.meta_template_id,
      can_edit: ["draft", "rejected"].includes(t.status),
      can_submit: t.status === "draft",
      display_status: t.status.charAt(0).toUpperCase() + t.status.slice(1),
      components, // Now including components (body text, etc.)
      variables   // Now including variables
    };
  });
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
    display_status:
      template.status.charAt(0).toUpperCase() + template.status.slice(1),
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
        { replacements: [metaT.id, tenant_id, metaT.name], transaction },
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
            {
              replacements: [localStatus, metaT.id, existing.template_id],
              transaction,
            },
          );
          syncedCount.updated++;
        }
      } else {
        // Import new template
        const template_id = await generateReadableIdFromLast(
          tableNames.WHATSAPP_TEMPLATE,
          "template_id",
          "WT",
        );

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
              "system", // Imported
            ],
            transaction,
          },
        );

        // Import components
        for (const comp of metaT.components) {
          let text = comp.text || null;
          let format = comp.format ? comp.format.toLowerCase() : null;
          let type = comp.type.toLowerCase();

          if (type === "body" || type === "footer" || type === "header") {
            await db.sequelize.query(
              `INSERT INTO ${tableNames.WHATSAPP_TEMPLATE_COMPONENTS}
                (template_id, component_type, header_format, text_content)
                VALUES (?, ?, ?, ?)`,
              {
                replacements: [template_id, type, format, text],
                transaction,
              },
            );

            // Extract variables from body or text header
            if (
              (type === "body" || (type === "header" && format === "text")) &&
              text
            ) {
              const matches = text.match(/{{\d+}}/g);
              if (matches) {
                const uniqueVars = [...new Set(matches)];
                for (const vKey of uniqueVars) {
                  const varKey = vKey.replace(/[{}]/g, "");
                  // Only insert if not already present for this template (in case same var key in header and body)
                  const [[existingVar]] = await db.sequelize.query(
                    `SELECT * FROM ${tableNames.WHATSAPP_TEMPLATE_VARIABLES} WHERE template_id = ? AND variable_key = ?`,
                    { replacements: [template_id, varKey], transaction },
                  );

                  if (!existingVar) {
                    await db.sequelize.query(
                      `INSERT INTO ${tableNames.WHATSAPP_TEMPLATE_VARIABLES}
                        (template_id, variable_key, sample_value)
                        VALUES (?, ?, ?)`,
                      {
                        replacements: [template_id, varKey, "Sample Data"],
                        transaction,
                      },
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

    // Log the soft delete action
    await db.sequelize.query(
      `
      INSERT INTO ${tableNames.WHATSAPP_TEMPLATE_SYNC_LOGS}
      (template_id, action, meta_status)
      VALUES (?, 'soft_delete', ?)
      `,
      {
        replacements: [template_id, template.status],
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

export const permanentDeleteTemplateService = async (
  template_id,
  tenant_id,
) => {
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
      throw new Error(
        "Active WhatsApp account required for permanent deletion from Meta",
      );
    }

    // Only delete from Meta if template was submitted (has meta_template_id and template_name)
    if (template.meta_template_id && template.template_name) {
      try {
        // Use WABA endpoint with template name - this is the correct Meta API for deletion
        await axios.delete(
          `https://graph.facebook.com/v23.0/${whatsappAccount.waba_id}/message_templates`,
          {
            params: { name: template.template_name },
            headers: {
              Authorization: `Bearer ${whatsappAccount.access_token}`,
            },
          },
        );
      } catch (metaErr) {
        // If 404 or other errors, log but don't fail - local deletion is more important
        console.error(
          "Meta template deletion warning:",
          metaErr.response?.data?.error?.message || metaErr.message,
        );
        // Don't throw - we still want to delete from local DB
        // Meta deletion is a courtesy, local DB deletion is mandatory
      }
    }

    // Delete from all related tables
    const tableReplacements = { replacements: [template_id], transaction };

    await db.sequelize.query(
      `DELETE FROM ${tableNames.WHATSAPP_TEMPLATE_COMPONENTS} WHERE template_id = ?`,
      tableReplacements,
    );
    await db.sequelize.query(
      `DELETE FROM ${tableNames.WHATSAPP_TEMPLATE_VARIABLES} WHERE template_id = ?`,
      tableReplacements,
    );
    await db.sequelize.query(
      `DELETE FROM ${tableNames.WHATSAPP_TEMPLATE_SYNC_LOGS} WHERE template_id = ?`,
      tableReplacements,
    );
    await db.sequelize.query(
      `DELETE FROM ${tableNames.WHATSAPP_TEMPLATE} WHERE template_id = ?`,
      tableReplacements,
    );

    await transaction.commit();
    return { success: true, message: "Template permanently deleted" };
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
};

export const updateWhatsappTemplateService = async (
  template_id,
  tenant_id,
  template_name,
  category,
  language,
  components,
  variables,
) => {
  const transaction = await db.sequelize.transaction();

  try {
    // Fetch current template
    const [[template]] = await db.sequelize.query(
      `SELECT * FROM ${tableNames.WHATSAPP_TEMPLATE} WHERE template_id = ? AND tenant_id = ? AND is_deleted = false`,
      { replacements: [template_id, tenant_id], transaction },
    );

    if (!template) {
      throw new Error("Template not found");
    }

    // Only allow editing draft, rejected, paused
    if (!["draft", "rejected", "paused"].includes(template.status)) {
      throw new Error(
        `Cannot edit template with status: ${template.status}. Only draft, rejected, or paused templates can be edited.`,
      );
    }

    // Validate body component
    if (!components?.body?.text) {
      throw new Error("Body component text is required");
    }

    const bodyText = components.body.text.trim();

    // Meta rules for body text
    if (/^{{\d+}}/.test(bodyText)) {
      throw new Error("Body cannot start with a variable");
    }

    if (/{{\d+}}[.!?,]*$/.test(bodyText)) {
      throw new Error("Body cannot end with a variable");
    }

    // Update main template
    await db.sequelize.query(
      `
      UPDATE ${tableNames.WHATSAPP_TEMPLATE}
      SET template_name = ?, category = ?, language = ?, updated_by = ?
      WHERE template_id = ? AND is_deleted = false
      `,
      {
        replacements: [
          template_name || template.template_name,
          category || template.category,
          language || template.language,
          template.updated_by,
          template_id,
        ],
        transaction,
      },
    );

    // Delete and recreate components
    await db.sequelize.query(
      `DELETE FROM ${tableNames.WHATSAPP_TEMPLATE_COMPONENTS} WHERE template_id = ?`,
      { replacements: [template_id], transaction },
    );

    // Insert new body component
    await db.sequelize.query(
      `
      INSERT INTO ${tableNames.WHATSAPP_TEMPLATE_COMPONENTS}
      (template_id, component_type, text_content)
      VALUES (?, 'body', ?)
      `,
      { replacements: [template_id, components.body.text], transaction },
    );

    // Insert header if provided
    if (components.header) {
      await db.sequelize.query(
        `
        INSERT INTO ${tableNames.WHATSAPP_TEMPLATE_COMPONENTS}
        (template_id, component_type, header_format, text_content)
        VALUES (?, 'header', ?, ?)
        `,
        {
          replacements: [
            template_id,
            components.header.format || "text",
            components.header.text || null,
          ],
          transaction,
        },
      );
    }

    // Insert footer if provided
    if (components.footer) {
      await db.sequelize.query(
        `
        INSERT INTO ${tableNames.WHATSAPP_TEMPLATE_COMPONENTS}
        (template_id, component_type, text_content)
        VALUES (?, 'footer', ?)
        `,
        {
          replacements: [template_id, components.footer.text || null],
          transaction,
        },
      );
    }

    // Delete and recreate variables
    await db.sequelize.query(
      `DELETE FROM ${tableNames.WHATSAPP_TEMPLATE_VARIABLES} WHERE template_id = ?`,
      { replacements: [template_id], transaction },
    );

    // Auto-extract variables from body text (bodyText already defined above)
    const extractedVariables = new Map(); // Use Map to avoid duplicates

    // Extract {{1}}, {{2}}, etc. from body
    const matches = bodyText.match(/{{\d+}}/g);
    if (matches) {
      const uniqueMatches = [...new Set(matches)];
      for (const match of uniqueMatches) {
        const varKey = match.replace(/[{}]/g, "");
        if (!extractedVariables.has(varKey)) {
          extractedVariables.set(varKey, "Sample Data");
        }
      }
    }

    // Extract from header if provided
    if (components.header?.text) {
      const headerMatches = components.header.text.match(/{{\d+}}/g);
      if (headerMatches) {
        const uniqueMatches = [...new Set(headerMatches)];
        for (const match of uniqueMatches) {
          const varKey = match.replace(/[{}]/g, "");
          if (!extractedVariables.has(varKey)) {
            extractedVariables.set(varKey, "Sample Data");
          }
        }
      }
    }

    // Merge with manually provided variables (manual ones override extracted)
    if (variables && Array.isArray(variables)) {
      for (const variable of variables) {
        const varKey = variable.key.replace(/[{}]/g, ""); // Clean up key
        extractedVariables.set(varKey, variable.sample);
      }
    }

    // Insert all variables
    for (const [varKey, sampleValue] of extractedVariables) {
      await db.sequelize.query(
        `
        INSERT INTO ${tableNames.WHATSAPP_TEMPLATE_VARIABLES}
        (template_id, variable_key, sample_value)
        VALUES (?, ?, ?)
        `,
        {
          replacements: [template_id, varKey, sampleValue],
          transaction,
        },
      );
    }

    // Log the update action
    await db.sequelize.query(
      `
      INSERT INTO ${tableNames.WHATSAPP_TEMPLATE_SYNC_LOGS}
      (template_id, action, meta_status)
      VALUES (?, 'update', ?)
      `,
      {
        replacements: [template_id, template.status],
        transaction,
      },
    );

    await transaction.commit();

    return {
      template_id,
      template_name: template_name || template.template_name,
      category: category || template.category,
      language: language || template.language,
      status: template.status,
      message: "Template updated successfully",
    };
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
};

export const generateAiTemplateService = async ({
  prompt,
  focus,
  style,
  optimization,
  previous_content = null,
  rejection_reason = null,
}) => {
  const systemPrompt = `You are an expert WhatsApp Marketing Copywriter. 
  Your goal is to generate or FIX high-converting WhatsApp message body content based on user instructions.
  
  RULES:
  1. Use {{1}}, {{2}}, etc. for dynamic variables (e.g., Name, Order ID, Date).
  2. The message must be professional yet engaging.
  3. Category: ${focus} (Marketing, Utility, or Authentication).
  4. Style: ${style} (Normal, Poetic, Exciting, or Funny).
  5. Optimize for: ${optimization} (Click Rate or Reply Rate).
  6. Output ONLY the message body text. No headers, no footers, no explanations.
  7. IMPORTANT (for Marketing/Utility): Meta requires at least 15 words total, OR 5 words per variable. Ensure the text is descriptive.
  8. IMPORTANT (for Authentication): These usually contain a verification code and should be concise. e.g. "Your verification code is {{1}}."
  
  ${previous_content
      ? `FIX MODE: 
  The previous version was: "${previous_content}"
  Reason for failure/rejection: "${rejection_reason || "Unknown"}"
  Please analyze the previous version, avoid the mistakes mentioned in the rejection reason, and ensure the new content strictly follows Meta category guidelines (e.g., Utility must NOT contain marketing language).`
      : ""
    }
  `;

  const userPrompt = `User Request: ${prompt}`;

  try {
    const aiResponse = await AiService("system", `${systemPrompt}\n\n${userPrompt}`);
    return aiResponse;
  } catch (err) {
    throw new Error(`AI Generation failed: ${err.message}`);
  }
};
