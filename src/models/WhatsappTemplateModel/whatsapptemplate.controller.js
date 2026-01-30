import { generateReadableIdFromLast } from "../../utils/generateReadableIdFromLast.js";
import { tableNames } from "../../database/tableName.js";
import { createWhatsappTemplateService } from "./whatsapptemplate.service.js";
import { missingFieldsChecker } from "../../utils/missingFields.js";

export const createWhatsappTemplateController = async (req, res) => {
  try {
    const loginUser = req.user;

    const { template_name, category, language, components, variables } =
      req.body;

    const requiredFields = {
      template_name,
      category,
      components,
    };

    const missingFields = await missingFieldsChecker(requiredFields);
    if (missingFields.length > 0) {
      return res.status(400).send({
        message: `Missing required field(s): ${missingFields.join(", ")}`,
      });
    }

    if (!components?.body?.text) {
      return res.status(400).json({
        message: "Body component text is required",
      });
    }

    const template_id = await generateReadableIdFromLast(
      tableNames.WHATSAPP_TEMPLATE,
      "template_id",
      "WT",
    );

    // await createWhatsappTemplateService({
    //   template_id,
    //   tenant_id: loginUser.tenant_id,
    //   template_name,
    //   category,
    //   language,
    //   components,
    //   variables,
    //   created_by: loginUser.tenant_user_id,
    // });

    await createWhatsappTemplateService(
      template_id,
      loginUser?.template_id,
      template_name,
      category,
      language,
      components,
      variables,
      loginUser?.tenant_user_id,
    );

    return res.status(201).json({
      message: "WhatsApp template created successfully",
      data: {
        template_id,
        status: "draft",
      },
    });
  } catch (err) {
    console.error("Create template error:", err);
    return res.status(500).json({
      message: err.message,
    });
  }
};
