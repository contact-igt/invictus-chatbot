import db from "../../database/index.js";
import { tableNames } from "../../database/tableName.js";

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

    // await db.sequelize.query(
    //   `
    //   INSERT INTO ${tableNames.WHATSAPP_TEMPLATE_COMPONENTS}
    //   (template_id, component_type, text_content)
    //   VALUES (?, 'body', ?)
    //   `,
    //   {
    //     replacements: [template_id, components.body.text],
    //     transaction,
    //   },
    // );

    // if (components.header) {
    //   const { type, text, media_url } = components.header;

    //   if (!type) {
    //     throw new Error("Header type is required");
    //   }

    //   await db.sequelize.query(
    //     `
    // INSERT INTO ${tableNames.WHATSAPP_TEMPLATE_COMPONENTS}
    // (template_id, component_type, header_format, text_content, media_url)
    // VALUES (?, 'header', ?, ?, ?)
    // `,
    //     {
    //       replacements: [template_id, type, text || null, media_url || null],
    //       transaction,
    //     },
    //   );
    // }

    // if (components.footer?.text) {
    //   await db.sequelize.query(
    //     `
    //     INSERT INTO ${tableNames.WHATSAPP_TEMPLATE_COMPONENTS}
    //     (template_id, component_type, text_content)
    //     VALUES (?, 'footer', ?)
    //     `,
    //     {
    //       replacements: [template_id, components.footer.text],
    //       transaction,
    //     },
    //   );
    // }

    // for (const variable of variables) {
    //   await db.sequelize.query(
    //     `
    //     INSERT INTO ${tableNames.WHATSAPP_TEMPLATE_VARIABLES}
    //     (template_id, variable_key, sample_value)
    //     VALUES (?, ?, ?)
    //     `,
    //     {
    //       replacements: [template_id, variable.key, variable.sample],
    //       transaction,
    //     },
    //   );
    // }

    await transaction.commit();
    return true;
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
};
