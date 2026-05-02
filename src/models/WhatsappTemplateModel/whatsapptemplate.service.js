import db from "../../database/index.js";
import { tableNames } from "../../database/tableName.js";
import axios from "axios";
import { getWhatsappAccountByTenantService } from "../WhatsappAccountModel/whatsappAccount.service.js";
import { generateReadableIdFromLast } from "../../utils/helpers/generateReadableIdFromLast.js";
import { getTemplateCopywriterPrompt } from "../../utils/ai/prompts/template.js";
import { AiService } from "../../utils/ai/coreAi.js";
import {
  addTemplateUsageService,
  markMediaAsApprovedService,
} from "../GalleryModel/gallery.service.js";
import { validateTemplateHeaderMedia } from "../../utils/mediaValidation.js";
import { logger } from "../../utils/logger.js";

const STATUS_MAP = {
  IN_REVIEW: "pending",
  PENDING: "pending",
  APPROVED: "approved",
  REJECTED: "rejected",
  PAUSED: "paused",
  DISABLED: "disabled",
};

const VALID_LOCAL_META_STATUSES = new Set([
  "draft",
  "pending",
  "approved",
  "rejected",
  "paused",
  "disabled",
]);

const resolveRestoredTemplateStatus = (previousStatus) => {
  const normalizedStatus = String(previousStatus || "")
    .trim()
    .toLowerCase();

  if (!VALID_LOCAL_META_STATUSES.has(normalizedStatus)) {
    return "draft";
  }

  return normalizedStatus === "approved" ? "paused" : normalizedStatus;
};

export const mapMetaStatusToLocal = (metaStatus) => {
  const normalizedMetaStatus = String(metaStatus || "")
    .trim()
    .toUpperCase();

  const mappedStatus = STATUS_MAP[normalizedMetaStatus] || "pending";

  return VALID_LOCAL_META_STATUSES.has(mappedStatus) ? mappedStatus : "pending";
};

const ensureValidLocalMetaStatus = (status) => {
  const normalizedStatus = String(status || "")
    .trim()
    .toLowerCase();

  if (VALID_LOCAL_META_STATUSES.has(normalizedStatus)) {
    return normalizedStatus;
  }

  return "pending";
};

const resolveMediaUrl = async (
  media_url,
  media_asset_id,
  transaction = null,
) => {
  if (media_url) return media_url;
  if (!media_asset_id) return null;
  const [[asset]] = await db.sequelize.query(
    `SELECT preview_url FROM ${tableNames.MEDIA_ASSETS} WHERE media_asset_id = ? AND is_deleted = false LIMIT 1`,
    { replacements: [media_asset_id], transaction },
  );
  return asset?.preview_url || null;
};

const getTemplateLinkedMediaAssetId = async (
  templateId,
  transaction = null,
) => {
  const [[templateMedia]] = await db.sequelize.query(
    `
    SELECT COALESCE(
      t.media_asset_id,
      (SELECT c2.media_asset_id
       FROM ${tableNames.WHATSAPP_TEMPLATE_COMPONENTS} c2
       WHERE c2.template_id = t.template_id
         AND c2.component_type = 'header'
         AND c2.media_asset_id IS NOT NULL
       LIMIT 1)
    ) AS media_asset_id
    FROM ${tableNames.WHATSAPP_TEMPLATE} t
    WHERE t.template_id = ?
      AND t.is_deleted = false
    LIMIT 1
    `,
    {
      replacements: [templateId],
      transaction,
    },
  );

  return templateMedia?.media_asset_id || null;
};

// Valid Meta WhatsApp language codes
const VALID_META_LANGUAGE_CODES = new Set([
  "af",
  "sq",
  "ar",
  "az",
  "bn",
  "bg",
  "ca",
  "zh_CN",
  "zh_HK",
  "zh_TW",
  "hr",
  "cs",
  "da",
  "nl",
  "en",
  "en_GB",
  "en_US",
  "et",
  "fil",
  "fi",
  "fr",
  "ka",
  "de",
  "el",
  "gu",
  "ha",
  "he",
  "hi",
  "hu",
  "id",
  "ga",
  "it",
  "ja",
  "kn",
  "kk",
  "rw_RW",
  "ko",
  "ky_KG",
  "lo",
  "lv",
  "lt",
  "mk",
  "ms",
  "ml",
  "mr",
  "nb",
  "fa",
  "pl",
  "pt_BR",
  "pt_PT",
  "pa",
  "ro",
  "ru",
  "sr",
  "sk",
  "sl",
  "es",
  "es_AR",
  "es_ES",
  "es_MX",
  "sw",
  "sv",
  "ta",
  "te",
  "th",
  "tr",
  "uk",
  "ur",
  "uz",
  "vi",
  "zu",
]);

const getMappedMetaTemplateStatus = async (metaTemplateId, whatsappAccount) => {
  const metaRes = await axios.get(
    `https://graph.facebook.com/v23.0/${metaTemplateId}`,
    {
      params: { fields: "status" },
      headers: {
        Authorization: `Bearer ${whatsappAccount.access_token}`,
      },
    },
  );

  return mapMetaStatusToLocal(metaRes.data.status);
};

const getHeaderMediaAssetMetadata = async ({
  tenantId,
  mediaAssetId,
  mediaHandle,
  transaction = null,
}) => {
  if (!tenantId || (!mediaAssetId && !mediaHandle)) {
    return null;
  }

  const lookupField = mediaAssetId ? "media_asset_id" : "media_handle";
  const lookupValue = mediaAssetId || mediaHandle;

  const [[asset]] = await db.sequelize.query(
    `
    SELECT media_asset_id, file_name, file_type, mime_type, media_handle, preview_url
    FROM ${tableNames.MEDIA_ASSETS}
    WHERE tenant_id = ?
      AND ${lookupField} = ?
      AND is_deleted = false
    LIMIT 1
    `,
    {
      replacements: [tenantId, lookupValue],
      transaction,
    },
  );

  return asset || null;
};

const sanitizeTemplateHeaderMediaReferences = async ({
  tenantId,
  header,
  transaction = null,
}) => {
  if (!header) {
    return { header: null, assetMetadata: null, hadTypeMismatch: false };
  }

  const normalizedHeaderFormat = String(
    header.header_format || header.format || header.type || "text",
  )
    .trim()
    .toLowerCase();

  if (!["image", "video", "document"].includes(normalizedHeaderFormat)) {
    return {
      header: {
        ...header,
        media_asset_id: null,
        media_handle: null,
        media_url: null,
      },
      assetMetadata: null,
      hadTypeMismatch: false,
    };
  }

  const assetMetadata = await getHeaderMediaAssetMetadata({
    tenantId,
    mediaAssetId: header.media_asset_id,
    mediaHandle: header.media_handle,
    transaction,
  });

  const hadTypeMismatch =
    !!assetMetadata && assetMetadata.file_type !== normalizedHeaderFormat;

  const mediaUrlLooksStale =
    hadTypeMismatch &&
    !!header.media_url &&
    header.media_url === assetMetadata.preview_url;

  return {
    header: {
      ...header,
      media_asset_id: hadTypeMismatch
        ? null
        : header.media_asset_id || assetMetadata?.media_asset_id || null,
      media_handle: hadTypeMismatch
        ? null
        : header.media_handle || assetMetadata?.media_handle || null,
      media_url: mediaUrlLooksStale
        ? null
        : header.media_url ||
          (!hadTypeMismatch ? assetMetadata?.preview_url || null : null),
    },
    assetMetadata: hadTypeMismatch ? null : assetMetadata,
    hadTypeMismatch,
  };
};

const validateTemplateHeaderMediaBeforeMetaSubmit = async ({
  template,
  header,
  transaction = null,
}) => {
  if (!header) {
    return { header: null, assetMetadata: null, hadTypeMismatch: false };
  }

  const headerFormat = String(header.header_format || "")
    .trim()
    .toLowerCase();

  if (!["image", "video", "document"].includes(headerFormat)) {
    return { header, assetMetadata: null, hadTypeMismatch: false };
  }

  const {
    header: sanitizedHeader,
    assetMetadata,
    hadTypeMismatch,
  } = await sanitizeTemplateHeaderMediaReferences({
    tenantId: template?.tenant_id,
    header,
    transaction,
  });

  if (!assetMetadata && !sanitizedHeader?.media_url) {
    return {
      header: sanitizedHeader,
      assetMetadata: null,
      hadTypeMismatch,
    };
  }

  const validation = validateTemplateHeaderMedia({
    expectedType: headerFormat,
    fileType: assetMetadata?.file_type || "",
    mimeType: assetMetadata?.mime_type || null,
    fileName:
      assetMetadata?.file_name ||
      sanitizedHeader?.media_url ||
      assetMetadata?.preview_url ||
      null,
  });

  if (!validation.valid) {
    const error = new Error(validation.error);
    error.errorCode = "UNSUPPORTED_TEMPLATE_MEDIA";
    throw error;
  }

  return {
    header: sanitizedHeader,
    assetMetadata,
    hadTypeMismatch,
  };
};

const resolveTemplateHeaderMediaHandleForPayload = async ({
  template,
  header,
  assetMetadata,
  format,
  whatsappAccount,
}) => {
  const tenantId = whatsappAccount?.tenant_id || template?.tenant_id;
  const sampleUrl = header?.media_url || assetMetadata?.preview_url || null;

  const canUploadFromUrl = (() => {
    try {
      const parsedUrl = new URL(sampleUrl);
      return ["http:", "https:"].includes(parsedUrl.protocol);
    } catch {
      return false;
    }
  })();

  if (!sampleUrl || !canUploadFromUrl || !tenantId) {
    return header?.media_handle || assetMetadata?.media_handle || null;
  }

  const { uploadMediaToMetaForTemplate } = await import(
    "../../utils/whatsapp/metaMediaUpload.js"
  );

  return uploadMediaToMetaForTemplate(
    tenantId,
    sampleUrl,
    format,
    { mimeType: assetMetadata?.mime_type || null },
  );
};

const deriveTemplateTypeFromComponents = (
  components = [],
  fallbackType = "text",
) => {
  const normalizedFallbackType = String(fallbackType || "text")
    .trim()
    .toLowerCase();

  const headerComponent = Array.isArray(components)
    ? components.find((component) => component.component_type === "header")
    : null;

  const carouselComponent = Array.isArray(components)
    ? components.find((component) => component.component_type === "carousel")
    : null;

  if (carouselComponent) {
    return "carousel";
  }

  const headerFormat = String(
    headerComponent?.header_format || normalizedFallbackType,
  )
    .trim()
    .toLowerCase();

  if (
    ["image", "video", "document", "location", "text"].includes(headerFormat)
  ) {
    return headerFormat;
  }

  return normalizedFallbackType;
};

const buildMetaTemplatePayload = async ({
  template,
  components,
  variables,
  whatsappAccount,
  includeIdentity = true,
  includeCategory = true,
  transaction = null,
}) => {
  const body = components.find((c) => c.component_type === "body");
  if (!body || !body.text_content) {
    throw new Error("BODY component is required");
  }

  let bodyText = body.text_content.trim();

  if (template.category === "authentication") {
    const authMetaComponents = [
      {
        type: "BODY",
        add_security_recommendation: true,
      },
      {
        type: "FOOTER",
        code_expiration_minutes: 10,
      },
      {
        type: "BUTTONS",
        buttons: [
          {
            type: "OTP",
            otp_type: "COPY_CODE",
          },
        ],
      },
    ];

    return {
      ...(includeIdentity
        ? {
            name: template.template_name,
            language: template.language,
            parameter_format: "positional",
          }
        : {}),
      ...(includeCategory ? { category: "AUTHENTICATION" } : {}),
      components: authMetaComponents,
    };
  }

  if (/^{{\d+}}/.test(bodyText)) {
    throw new Error("Template body cannot start with a variable");
  }

  if (/{{\d+}}[.!?,]*$/.test(bodyText)) {
    bodyText = bodyText.replace(/({{\d+}})[.!?,]*$/, "$1 time");
  }

  const variableCount = (bodyText.match(/{{\d+}}/g) || []).length;
  const bodyWordCount = bodyText
    .replace(/{{\d+}}/g, "")
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0).length;
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

  const metaComponents = [];
  const header = components.find((c) => c.component_type === "header");

  if (header) {
    const format = (header.header_format || "text").toUpperCase();
    const headerObj = {
      type: "HEADER",
      format,
    };

    if (format === "TEXT") {
      headerObj.text = header.text_content;
      if (header.text_content?.includes("{{1}}")) {
        const headerVar = variables.find(
          (v) => v.variable_key === "1" || v.variable_key === "header_1",
        );
        if (headerVar) {
          headerObj.example = { header_text: [headerVar.sample_value] };
        }
      }
    } else if (["IMAGE", "VIDEO", "DOCUMENT"].includes(format)) {
      const { header: sanitizedHeader, assetMetadata } =
        await validateTemplateHeaderMediaBeforeMetaSubmit({
          template,
          header,
          transaction,
        });

      const resolvedMediaHandle = await resolveTemplateHeaderMediaHandleForPayload({
        template,
        header: sanitizedHeader,
        assetMetadata,
        format,
        whatsappAccount,
      });

      if (resolvedMediaHandle) {
        headerObj.example = { header_handle: [resolvedMediaHandle] };
      } else {
        const defaultSamples = {
          IMAGE: "https://www.facebook.com/images/fb_icon_325x325.png",
          VIDEO: "https://www.w3schools.com/html/mov_bbb.mp4",
          DOCUMENT:
            "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf",
        };
        const sampleUrl =
          sanitizedHeader?.media_url ||
          assetMetadata?.preview_url ||
          defaultSamples[format];
        if (sampleUrl) {
          try {
            const { uploadMediaToMetaForTemplate } =
              await import("../../utils/whatsapp/metaMediaUpload.js");
            const headerHandle = await uploadMediaToMetaForTemplate(
              whatsappAccount.tenant_id,
              sampleUrl,
              format,
              { mimeType: assetMetadata?.mime_type || null },
            );
            headerObj.example = { header_handle: [headerHandle] };
          } catch (uploadError) {
            throw new Error(
              `Failed to upload media sample to Meta: ${uploadError.message}`,
            );
          }
        }
      }
    }

    metaComponents.push(headerObj);
  }

  const sortedVariables = (variables || [])
    .sort((a, b) => parseInt(a.variable_key) - parseInt(b.variable_key))
    .map((v) => v.sample_value);

  const uniquePlaceholders = new Set(bodyText.match(/{{\d+}}/g) || []);
  if (header && header.header_format === "text" && header.text_content) {
    for (const m of header.text_content.match(/{{\d+}}/g) || []) {
      uniquePlaceholders.add(m);
    }
  }

  const footer = components.find((c) => c.component_type === "footer");
  if (footer && footer.text_content) {
    for (const m of footer.text_content.match(/{{\d+}}/g) || []) {
      uniquePlaceholders.add(m);
    }
  }

  const totalPlaceholderCount = uniquePlaceholders.size;

  if (totalPlaceholderCount !== variables.length) {
    throw new Error(
      `Variable count mismatch: expected ${totalPlaceholderCount} but got ${variables.length}`,
    );
  }

  const bodyVariablesMatch = bodyText.match(/{{\d+}}/g) || [];
  const bodyVariableKeys = bodyVariablesMatch.map((match) =>
    parseInt(match.replace(/[{}]/g, "")),
  );
  const bodyVariablesExample = bodyVariableKeys.map(
    (key) => sortedVariables[key - 1],
  );

  const bodyComponent = {
    type: "BODY",
    text: bodyText,
  };

  if (bodyVariablesExample.length > 0) {
    bodyComponent.example = {
      body_text: [bodyVariablesExample],
    };
  }

  metaComponents.push(bodyComponent);

  if (footer) {
    metaComponents.push({
      type: "FOOTER",
      text: footer.text_content,
    });
  }

  const carouselComp = components.find((c) => c.component_type === "carousel");
  if (carouselComp && carouselComp.text_content) {
    try {
      const carouselData = JSON.parse(carouselComp.text_content);
      if (carouselData && Array.isArray(carouselData.cards)) {
        const { uploadMediaToMetaForTemplate } =
          await import("../../utils/whatsapp/metaMediaUpload.js");
        const cardPromises = carouselData.cards.map(async (card) => {
          const format = carouselData.mediaType || "IMAGE";
          const defaultSamples = {
            IMAGE: "https://www.facebook.com/images/fb_icon_325x325.png",
            VIDEO: "https://www.w3schools.com/html/mov_bbb.mp4",
          };
          const sampleUrl =
            card.media_url || defaultSamples[format] || defaultSamples.IMAGE;

          const headerHandle = await uploadMediaToMetaForTemplate(
            whatsappAccount.tenant_id,
            sampleUrl,
            format,
          );

          const cardComponents = [
            {
              type: "HEADER",
              format,
              example: {
                header_handle: [headerHandle],
              },
            },
            {
              type: "BODY",
              text: card.bodyText || "Sample Card Body",
            },
          ];

          if (
            card.buttons &&
            Array.isArray(card.buttons) &&
            card.buttons.length > 0
          ) {
            cardComponents.push({
              type: "BUTTONS",
              buttons: card.buttons.slice(0, 2).map((btn) => ({
                type: "QUICK_REPLY",
                text: btn.text || "Quick Reply",
              })),
            });
          }

          return { components: cardComponents };
        });

        const resolvedCards = await Promise.all(cardPromises);

        metaComponents.push({
          type: "CAROUSEL",
          cards: resolvedCards,
        });
      }
    } catch (e) {
      console.error("Error parsing carousel component for Meta payload:", e);
    }
  }

  const buttonsComp = components.find((c) => c.component_type === "buttons");
  if (buttonsComp && buttonsComp.text_content) {
    try {
      const buttons = JSON.parse(buttonsComp.text_content);
      if (buttons.length > 0) {
        metaComponents.push({
          type: "BUTTONS",
          buttons: buttons.map((btn) => {
            const b = {
              type: btn.type,
            };

            if (btn.type !== "CATALOG" && btn.type !== "COPY_CODE") {
              b.text =
                btn.text ||
                btn.label ||
                (btn.type === "URL" ? "Visit Website" : "Call");
            }

            if (btn.type === "PHONE_NUMBER") {
              const rawPhone = (btn.phone_number || btn.value || "").trim();
              const phone = rawPhone.replace(/\s+/g, "");
              if (!/^\+[1-9]\d{10,14}$/.test(phone)) {
                throw new Error(
                  `Invalid phone number for button "${btn.text}": Include + country code and 10 to 14 digits`,
                );
              }
              b.phone_number = phone;
            }
            if (btn.type === "URL") {
              b.url = btn.url || btn.value;
              if (b.url && b.url.includes("{{1}}")) {
                const urlVar = variables.find(
                  (v) => v.variable_key === "url_1" || v.variable_key === "1",
                );
                if (urlVar) {
                  b.example = [urlVar.sample_value];
                }
              }
            }
            if (btn.type === "COPY_CODE") {
              b.example = btn.example || btn.value || "CODE123";
            }
            return b;
          }),
        });
      }
    } catch (e) {
      console.error("Error parsing buttons for Meta payload:", e);
    }
  }

  return {
    ...(includeIdentity
      ? {
          name: template.template_name,
          language: template.language,
          parameter_format: "positional",
        }
      : {}),
    ...(includeCategory ? { category: template.category.toUpperCase() } : {}),
    components: metaComponents,
  };
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
  template_type,
  language,
  components,
  variables,
  created_by,
) => {
  const transaction = await db.sequelize.transaction();

  try {
    const headerMediaAssetId = components?.header?.media_asset_id || null;
    const headerMediaHandle = components?.header?.media_handle || null;
    const normalizedTemplateType = deriveTemplateTypeFromComponents(
      [
        ...(components?.header
          ? [
              {
                component_type: "header",
                header_format: (
                  components.header.format ||
                  components.header.type ||
                  template_type ||
                  "text"
                ).toLowerCase(),
              },
            ]
          : []),
        ...(components?.carousel ? [{ component_type: "carousel" }] : []),
      ],
      template_type,
    );

    // Validate language code
    if (!language || !VALID_META_LANGUAGE_CODES.has(language)) {
      throw new Error(
        `Invalid language code "${language}". Please select a valid template language.`,
      );
    }

    const bodyText = components.body.text.trim();

    if (/^{{\d+}}/.test(bodyText)) {
      throw new Error("Body cannot start with a variable");
    }

    await db.sequelize.query(
      `
      INSERT INTO ${tableNames.WHATSAPP_TEMPLATE}
      (template_id, tenant_id, template_name, category, template_type, language, media_asset_id, media_handle, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      {
        replacements: [
          template_id,
          tenant_id,
          template_name,
          category,
          normalizedTemplateType,
          language,
          headerMediaAssetId,
          headerMediaHandle,
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
        replacements: [template_id, bodyText],
        transaction,
      },
    );

    if (components.header) {
      const { type, format, text, media_url, media_asset_id, media_handle } =
        components.header;
      const headerFormat = (format || type || "text").toLowerCase();

      if (!type) {
        throw new Error("Header type is required");
      }

      const resolvedMediaUrl = await resolveMediaUrl(
        media_url,
        media_asset_id,
        transaction,
      );

      await db.sequelize.query(
        `
    INSERT INTO ${tableNames.WHATSAPP_TEMPLATE_COMPONENTS}
    (template_id, component_type, header_format, text_content, media_url, media_asset_id, media_handle)
    VALUES (?, 'header', ?, ?, ?, ?, ?)
    `,
        {
          replacements: [
            template_id,
            headerFormat,
            text ? text : null,
            resolvedMediaUrl,
            media_asset_id || null,
            media_handle || null,
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

    if (
      components.buttons &&
      Array.isArray(components.buttons) &&
      components.buttons.length > 0
    ) {
      // Validate phone numbers before saving
      for (const btn of components.buttons) {
        if (btn.type === "PHONE_NUMBER") {
          const phone = (btn.value || "").replace(/\s+/g, "");
          if (!/^\+[1-9]\d{10,14}$/.test(phone)) {
            throw new Error(
              `Invalid phone number for button "${btn.text}": Include + country code and 10 to 14 digits`,
            );
          }
        }
      }

      await db.sequelize.query(
        `
        INSERT INTO ${tableNames.WHATSAPP_TEMPLATE_COMPONENTS}
        (template_id, component_type, text_content)
        VALUES (?, 'buttons', ?)
        `,
        {
          replacements: [template_id, JSON.stringify(components.buttons)],
          transaction,
        },
      );
    }

    if (components.carousel) {
      await db.sequelize.query(
        `
        INSERT INTO ${tableNames.WHATSAPP_TEMPLATE_COMPONENTS}
        (template_id, component_type, text_content)
        VALUES (?, 'carousel', ?)
        `,
        {
          replacements: [template_id, JSON.stringify(components.carousel)],
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
          replacements: [
            template_id,
            varKey,
            variable.sample || variable.value,
          ],
          transaction,
        },
      );
    }

    await transaction.commit();

    // Track usage of gallery asset if used in header
    if (headerMediaAssetId) {
      addTemplateUsageService(headerMediaAssetId, template_id).catch((err) =>
        console.error(
          "[TEMPLATE-CREATE] Failed to log gallery asset usage:",
          err.message,
        ),
      );
    }

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
    const normalizedTemplateType = deriveTemplateTypeFromComponents(
      components,
      template.template_type,
    );
    const normalizedTemplate = {
      ...template,
      template_type: normalizedTemplateType,
    };

    const payload = await buildMetaTemplatePayload({
      template: normalizedTemplate,
      components,
      variables,
      whatsappAccount,
      includeIdentity: true,
      includeCategory: true,
      transaction,
    });

    console.log(
      "🚀 Meta Payload being sent:",
      JSON.stringify(payload, null, 2),
    );

    const bodyMetaComponent = payload.components?.find(
      (component) => component.type === "BODY",
    );

    console.log("📋 BODY Component Details:", {
      bodyComponent: bodyMetaComponent,
      bodyComponentString: JSON.stringify(bodyMetaComponent),
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
        `https://graph.facebook.com/v23.0/${whatsappAccount.waba_id}/message_templates`,
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
    const metaStatus = mapMetaStatusToLocal(response.data.status);

    // ─────────────────────────────────────────
    // Update template
    // ─────────────────────────────────────────
    await db.sequelize.query(
      `
      UPDATE ${tableNames.WHATSAPP_TEMPLATE}
      SET meta_template_id = ?, status = 'pending', template_type = ?
      WHERE template_id = ? AND is_deleted = false
      `,
      {
        replacements: [
          metaTemplateId,
          normalizedTemplateType,
          template.template_id,
        ],
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
          ensureValidLocalMetaStatus(metaStatus),
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
      if (template.status === "draft") {
        await transaction.rollback();
        return {
          status: "draft",
          meta_status: null,
          skipped: true,
          source: "local",
        };
      }

      throw new Error("Template not submitted to Meta");
    }

    // ✅ Meta API — single template endpoint only supports "status" field.
    // "rejection_reason" is NOT available here; it comes from webhooks or the bulk list API.
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
    const mappedStatus = mapMetaStatusToLocal(metaStatus);

    // Update main table.
    // If status is moving OUT of rejected, clear the stored rejection_reason.
    // If still rejected, preserve the existing rejection_reason (set by webhook/bulk-pull).
    const clearRejectionReason = mappedStatus !== "rejected";
    const updateQuery = clearRejectionReason
      ? `UPDATE ${tableNames.WHATSAPP_TEMPLATE} SET status = ?, rejection_reason = NULL WHERE template_id = ? AND is_deleted = false`
      : `UPDATE ${tableNames.WHATSAPP_TEMPLATE} SET status = ? WHERE template_id = ? AND is_deleted = false`;

    // Update main table
    await db.sequelize.query(updateQuery, {
      replacements: [mappedStatus, template.template_id],
      transaction,
    });

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
          ensureValidLocalMetaStatus(mappedStatus),
        ],
        transaction,
      },
    );

    await transaction.commit();

    const linkedMediaAssetId = await getTemplateLinkedMediaAssetId(
      template.template_id,
    );

    // Keep gallery media approval in sync with template sync flow (same as webhook behavior).
    if (mappedStatus === "approved" && linkedMediaAssetId) {
      try {
        await markMediaAsApprovedService(linkedMediaAssetId);
      } catch (mediaErr) {
        console.error(
          `[TEMPLATE-SYNC] Failed to auto-approve gallery media ${linkedMediaAssetId}:`,
          mediaErr.message,
        );
      }
    }

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
  try {
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
  } catch (err) {
    throw err;
  }
};

export const getTemplateListService = async (tenant_id) => {
  const dataQuery = `
    SELECT *
    FROM ${tableNames.WHATSAPP_TEMPLATE}
    WHERE tenant_id = ? AND is_deleted = false
    ORDER BY created_at DESC
  `;

  try {
    const [templates] = await db.sequelize.query(dataQuery, {
      replacements: [tenant_id],
    });

    // Fetch components and variables for all templates
    const templateIds = templates.map((t) => t.template_id);

    let allComponents = [];
    let allVariables = [];

    if (templateIds.length > 0) {
      [allComponents] = await db.sequelize.query(
        `SELECT c.*,
                COALESCE(c.media_url, ma.preview_url) AS media_url,
                ma.file_name AS asset_file_name
         FROM ${tableNames.WHATSAPP_TEMPLATE_COMPONENTS} c
         LEFT JOIN ${tableNames.MEDIA_ASSETS} ma
           ON ma.media_asset_id = c.media_asset_id AND ma.is_deleted = false
         WHERE c.template_id IN (?)`,
        { replacements: [templateIds] },
      );

      [allVariables] = await db.sequelize.query(
        `SELECT * FROM ${tableNames.WHATSAPP_TEMPLATE_VARIABLES} WHERE template_id IN (?) ORDER BY variable_key ASC`,
        { replacements: [templateIds] },
      );
    }

    const mappedTemplates = templates.map((t) => {
      const components = allComponents.filter(
        (c) => c.template_id === t.template_id,
      );
      const variables = allVariables
        .filter((v) => v.template_id === t.template_id)
        .map((v) => ({ ...v, key: v.variable_key, value: v.sample_value }));

      return {
        ...t,
        is_submitted: !!t.meta_template_id,
        can_edit: ["draft", "rejected", "paused", "approved"].includes(
          t.status,
        ),
        can_submit: ["draft", "rejected", "paused"].includes(t.status),
        display_status: t.status.charAt(0).toUpperCase() + t.status.slice(1),
        components,
        variables,
      };
    });

    return {
      templates: mappedTemplates,
    };
  } catch (err) {
    throw err;
  }
};

export const getTemplateByIdService = async (template_id, tenant_id) => {
  try {
    // Join all related data
    const [[template]] = await db.sequelize.query(
      `SELECT * FROM ${tableNames.WHATSAPP_TEMPLATE} WHERE template_id = ? AND tenant_id = ? AND is_deleted = false`,
      { replacements: [template_id, tenant_id] },
    );

    if (!template) return null;

    const [components] = await db.sequelize.query(
      `SELECT c.*,
              COALESCE(c.media_url, ma.preview_url) AS media_url,
              ma.file_name AS asset_file_name
       FROM ${tableNames.WHATSAPP_TEMPLATE_COMPONENTS} c
       LEFT JOIN ${tableNames.MEDIA_ASSETS} ma
         ON ma.media_asset_id = c.media_asset_id AND ma.is_deleted = false
       WHERE c.template_id = ?`,
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
      can_edit: ["draft", "rejected", "paused", "approved"].includes(
        template.status,
      ),
      can_submit: ["draft", "rejected", "paused"].includes(template.status),
      display_status:
        template.status.charAt(0).toUpperCase() + template.status.slice(1),
      components,
      variables: variables.map((v) => ({
        ...v,
        key: v.variable_key,
        value: v.sample_value,
      })),
      logs,
    };
  } catch (err) {
    throw err;
  }
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
    let nextUrl = `https://graph.facebook.com/v23.0/${whatsappAccount.waba_id}/message_templates?fields=id,name,status,rejection_reason,category,language,components&limit=100`;

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
      const localStatus = mapMetaStatusToLocal(metaT.status);

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
          const rejectionReason =
            localStatus === "rejected" ? metaT.rejection_reason || null : null;
          await db.sequelize.query(
            `UPDATE ${tableNames.WHATSAPP_TEMPLATE} SET status = ?, rejection_reason = ?, meta_template_id = ? WHERE template_id = ?`,
            {
              replacements: [
                localStatus,
                rejectionReason,
                metaT.id,
                existing.template_id,
              ],
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

        // Derive template_type from header component format
        const headerComp = metaT.components.find(
          (c) => c.type.toLowerCase() === "header",
        );
        const templateType = headerComp?.format
          ? headerComp.format.toLowerCase()
          : "text";

        await db.sequelize.query(
          `INSERT INTO ${tableNames.WHATSAPP_TEMPLATE} 
           (template_id, tenant_id, template_name, category, language, template_type, status, meta_template_id, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          {
            replacements: [
              template_id,
              tenant_id,
              metaT.name,
              metaT.category.toLowerCase(),
              metaT.language,
              templateType,
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

          if (
            type === "body" ||
            type === "footer" ||
            type === "header" ||
            type === "buttons"
          ) {
            let contentValue = text;
            if (type === "buttons") {
              contentValue = JSON.stringify(comp.buttons);
            }

            await db.sequelize.query(
              `INSERT INTO ${tableNames.WHATSAPP_TEMPLATE_COMPONENTS}
                (template_id, component_type, header_format, text_content)
                VALUES (?, ?, ?, ?)`,
              {
                replacements: [template_id, type, format, contentValue],
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
      `UPDATE ${tableNames.WHATSAPP_TEMPLATE}
       SET is_deleted = true,
           deleted_at = NOW(),
           previous_status = status
       WHERE template_id = ?`,
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
        replacements: [
          template_id,
          ensureValidLocalMetaStatus(template.status),
        ],
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
  template_type,
  language,
  components,
  variables,
  updated_by,
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

    // Only allow editing draft, rejected, paused, approved
    if (
      !["draft", "rejected", "paused", "approved"].includes(template.status)
    ) {
      throw new Error(
        `Cannot edit template with status: ${template.status}. Only draft, rejected, paused, or approved templates can be edited.`,
      );
    }

    // Validate language code
    if (language && !VALID_META_LANGUAGE_CODES.has(language)) {
      throw new Error(
        `Invalid language code "${language}". Please select a valid template language.`,
      );
    }

    // If template is already submitted to Meta, name and language cannot change.
    // Meta allows category edits for rejected/paused templates, but not for approved ones.
    if (template.status !== "draft") {
      const isNameChanged =
        template_name &&
        template_name.toLowerCase() !== template.template_name.toLowerCase();
      const isLanguageChanged =
        language && language.toLowerCase() !== template.language.toLowerCase();
      const isCategoryChanged =
        category && category.toLowerCase() !== template.category.toLowerCase();

      if (isNameChanged || isLanguageChanged) {
        throw new Error(
          "Template name and language cannot be changed after the template has been submitted to Meta.",
        );
      }

      if (template.status === "approved" && isCategoryChanged) {
        throw new Error(
          "Approved templates cannot change category after submission to Meta.",
        );
      }

      if (!template.meta_template_id) {
        throw new Error(
          "Submitted template is missing its Meta template ID. Please sync templates before editing.",
        );
      }
    }

    // Validate body component
    if (!components?.body?.text) {
      throw new Error("Body component text is required");
    }

    const sanitizedHeader = components?.header
      ? (
          await sanitizeTemplateHeaderMediaReferences({
            tenantId: tenant_id,
            header: {
              ...components.header,
              header_format: (
                components.header.format ||
                components.header.type ||
                template_type ||
                template.template_type ||
                "text"
              ).toLowerCase(),
            },
            transaction,
          })
        ).header
      : null;
    const headerMediaAssetId = sanitizedHeader?.media_asset_id || null;
    const headerMediaHandle = sanitizedHeader?.media_handle || null;

    const normalizedTemplateType = deriveTemplateTypeFromComponents(
      [
        ...(sanitizedHeader
          ? [
              {
                component_type: "header",
                header_format: (
                  sanitizedHeader.header_format ||
                  sanitizedHeader.format ||
                  sanitizedHeader.type ||
                  template_type ||
                  template.template_type ||
                  "text"
                ).toLowerCase(),
              },
            ]
          : []),
        ...(components?.carousel ? [{ component_type: "carousel" }] : []),
      ],
      template_type || template.template_type,
    );

    const bodyText = components.body.text.trim();

    // Meta rules for body text
    if (/^{{\d+}}/.test(bodyText)) {
      throw new Error("Body cannot start with a variable");
    }

    const shouldEditOnMeta =
      template.status !== "draft" && !!template.meta_template_id;
    let nextStatus = template.status;
    let metaEditPayload = null;
    let metaEditResponse = null;
    let approvedEditCount = null;
    let approvedPeriodStart = null;
    let approvedEditTimestamp = null;

    if (shouldEditOnMeta) {
      const whatsappAccount =
        await getWhatsappAccountByTenantService(tenant_id);
      if (!whatsappAccount || whatsappAccount.status !== "active") {
        throw new Error("WhatsApp account not active");
      }

      // ── Pre-flight edit-limit checks — APPROVED templates only ──────────
      // Rejected / paused templates have no Meta edit limits; only approved ones do.
      if (template.status === "approved") {
        const now = Date.now();

        // 1. 24-hour cooldown — ONLY based on last_edited_at (last successful Meta edit).
        //    created_at / updated_at are intentionally ignored: the 24h lock starts
        //    AFTER AN EDIT, not after creation or approval.
        //    If last_edited_at is null the template has never been edited → allow immediately.
        const lastEditedAt = template.last_edited_at ?? null;
        if (lastEditedAt) {
          const hoursSinceEdit =
            (now - new Date(lastEditedAt).getTime()) / 3_600_000;
          if (hoursSinceEdit < 24) {
            const hoursLeft = Math.max(1, Math.ceil(24 - hoursSinceEdit));
            const nextEditAt = new Date(
              new Date(lastEditedAt).getTime() + 24 * 3_600_000,
            ).toISOString();
            const err = new Error(
              `Meta allows editing approved templates only once per 24 hours. Try again in ${hoursLeft} hour(s).`,
            );
            err.errorCode = "EDIT_LIMIT_24H";
            err.hoursRemaining = hoursLeft;
            err.nextEditAt = nextEditAt;
            throw err;
          }
        }

        // 2. 30-day window — reset counter if 30 days have passed since period start
        let editCount = template.edit_count_30d || 0;
        let periodStart = template.edit_period_start
          ? new Date(template.edit_period_start)
          : null;

        const daysSincePeriodStart = periodStart
          ? (now - periodStart.getTime()) / 86_400_000
          : null;

        if (!periodStart || daysSincePeriodStart >= 30) {
          // New 30-day window starts now — reset counter
          editCount = 0;
          periodStart = new Date(now);
        }

        if (editCount >= 10) {
          const periodEndAt = new Date(
            periodStart.getTime() + 30 * 86_400_000,
          ).toISOString();
          const daysLeft = Math.max(1, Math.ceil(30 - daysSincePeriodStart));
          const err = new Error(
            `This template has reached the maximum of 10 edits in the current 30-day period. Next window opens in ${daysLeft} day(s).`,
          );
          err.errorCode = "EDIT_LIMIT_30DAYS";
          err.editsUsed = editCount;
          err.editsAllowed = 10;
          err.periodEndAt = periodEndAt;
          err.daysRemaining = daysLeft;
          throw err;
        }

        approvedEditCount = editCount;
        approvedPeriodStart = periodStart;
        approvedEditTimestamp = now;
      }
      // ─────────────────────────────────────────────────────────────────────

      metaEditPayload = await buildMetaTemplatePayload({
        template: {
          ...template,
          category: category || template.category,
        },
        components: [
          ...(sanitizedHeader
            ? [
                {
                  component_type: "header",
                  header_format: (
                    sanitizedHeader.header_format ||
                    sanitizedHeader.format ||
                    sanitizedHeader.type ||
                    "text"
                  ).toLowerCase(),
                  text_content: sanitizedHeader.text || null,
                  media_asset_id: sanitizedHeader.media_asset_id || null,
                  media_url: sanitizedHeader.media_url || null,
                  media_handle: sanitizedHeader.media_handle || null,
                },
              ]
            : []),
          {
            component_type: "body",
            text_content: components.body.text,
          },
          ...(components.footer
            ? [
                {
                  component_type: "footer",
                  text_content: components.footer.text || null,
                },
              ]
            : []),
          ...(components.buttons && Array.isArray(components.buttons)
            ? [
                {
                  component_type: "buttons",
                  text_content: JSON.stringify(components.buttons),
                },
              ]
            : []),
          ...(components.carousel
            ? [
                {
                  component_type: "carousel",
                  text_content: JSON.stringify(components.carousel),
                },
              ]
            : []),
        ],
        variables: [
          ...new Map(
            (variables || []).map((variable) => [
              String(variable.key || "").replace(/[{}]/g, ""),
              {
                variable_key: String(variable.key || "").replace(/[{}]/g, ""),
                sample_value: variable.sample || variable.value,
              },
            ]),
          ).values(),
        ],
        whatsappAccount,
        includeIdentity: false,
        includeCategory: true,
        transaction,
      });

      try {
        metaEditResponse = await axios.post(
          `https://graph.facebook.com/v23.0/${template.meta_template_id}`,
          metaEditPayload,
          {
            headers: {
              Authorization: `Bearer ${whatsappAccount.access_token}`,
              "Content-Type": "application/json",
            },
          },
        );

        // For rejected/paused templates: always set pending after a successful edit.
        // Meta does NOT instantly reflect IN_REVIEW on their GET endpoint — querying
        // immediately returns stale REJECTED/PAUSED status. The webhook will update us later.
        // For approved templates: query Meta so we respect any edge-case status change.
        if (template.status === "rejected" || template.status === "paused") {
          nextStatus = "pending";
        } else {
          nextStatus = await getMappedMetaTemplateStatus(
            template.meta_template_id,
            whatsappAccount,
          );
        }

        // ── Post-success: persist edit-limit tracking fields (approved only) ─
        if (template.status === "approved") {
          const newEditCount = approvedEditCount + 1;
          const newPeriodStart = approvedPeriodStart
            .toISOString()
            .slice(0, 19)
            .replace("T", " ");
          const newLastEditedAt = new Date(approvedEditTimestamp)
            .toISOString()
            .slice(0, 19)
            .replace("T", " ");

          await db.sequelize.query(
            `UPDATE ${tableNames.WHATSAPP_TEMPLATE}
             SET last_edited_at = ?, edit_period_start = ?, edit_count_30d = ?
             WHERE template_id = ? AND is_deleted = false`,
            {
              replacements: [
                newLastEditedAt,
                newPeriodStart,
                newEditCount,
                template_id,
              ],
              transaction,
            },
          );
        }
        // ─────────────────────────────────────────────────────────────────
      } catch (metaErr) {
        // Re-throw our own structured errors unchanged
        if (metaErr.errorCode) throw metaErr;

        const metaData = metaErr.response?.data?.error;
        const metaMsg =
          metaData?.error_user_msg || metaData?.message || metaErr.message;

        // ── Edge case: Meta rejects because the template was edited outside our system
        //    (e.g., directly in Meta Business Manager UI). Our DB has no record of that edit,
        //    so our pre-flight check passes but Meta returns a 24-hour error.
        //    Record the lock now so future attempts respect it.
        const is24hRejection =
          metaData?.code === 1018007 ||
          (typeof metaMsg === "string" &&
            metaMsg.toLowerCase().includes("24 hour"));

        if (is24hRejection && template.status === "approved") {
          try {
            // Use a fresh query (no transaction) so this persists even though the
            // main transaction will be rolled back.
            const lockTs = new Date()
              .toISOString()
              .slice(0, 19)
              .replace("T", " ");
            await db.sequelize.query(
              `UPDATE ${tableNames.WHATSAPP_TEMPLATE}
               SET last_edited_at = ?
               WHERE template_id = ? AND is_deleted = false`,
              { replacements: [lockTs, template_id] },
            );
          } catch (lockErr) {
            console.error(
              "[TEMPLATE-EDIT] Failed to record Meta 24h lock:",
              lockErr.message,
            );
          }
          const lockErr = new Error(
            `Meta rejected this edit: the template was edited recently (possibly from the Meta UI). Try again in 24 hours.`,
          );
          lockErr.errorCode = "EDIT_LIMIT_24H";
          lockErr.hoursRemaining = 24;
          lockErr.nextEditAt = new Date(
            Date.now() + 24 * 3_600_000,
          ).toISOString();
          throw lockErr;
        }

        throw new Error(`Template edit failed on Meta: ${metaMsg}`);
      }
    }

    // Update main template
    await db.sequelize.query(
      `
      UPDATE ${tableNames.WHATSAPP_TEMPLATE}
      SET template_name = ?, category = ?, template_type = ?, language = ?, media_asset_id = ?, media_handle = ?, updated_by = ?, status = ?
      WHERE template_id = ? AND is_deleted = false
      `,
      {
        replacements: [
          template_name || template.template_name,
          category || template.category,
          normalizedTemplateType,
          language || template.language,
          headerMediaAssetId,
          headerMediaHandle,
          updated_by,
          nextStatus,
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
      { replacements: [template_id, bodyText], transaction },
    );

    // Insert header if provided
    if (sanitizedHeader) {
      const resolvedMediaUrl = await resolveMediaUrl(
        sanitizedHeader.media_url,
        sanitizedHeader.media_asset_id,
        transaction,
      );

      await db.sequelize.query(
        `
        INSERT INTO ${tableNames.WHATSAPP_TEMPLATE_COMPONENTS}
        (template_id, component_type, header_format, text_content, media_url, media_asset_id, media_handle)
        VALUES (?, 'header', ?, ?, ?, ?, ?)
        `,
        {
          replacements: [
            template_id,
            (
              sanitizedHeader.header_format ||
              sanitizedHeader.format ||
              sanitizedHeader.type ||
              "text"
            ).toLowerCase(),
            sanitizedHeader.text || null,
            resolvedMediaUrl,
            sanitizedHeader.media_asset_id || null,
            sanitizedHeader.media_handle || null,
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

    // Insert buttons if provided
    if (
      components.buttons &&
      Array.isArray(components.buttons) &&
      components.buttons.length > 0
    ) {
      await db.sequelize.query(
        `
        INSERT INTO ${tableNames.WHATSAPP_TEMPLATE_COMPONENTS}
        (template_id, component_type, text_content)
        VALUES (?, 'buttons', ?)
        `,
        {
          replacements: [template_id, JSON.stringify(components.buttons)],
          transaction,
        },
      );
    }

    // Insert carousel if provided
    if (components.carousel) {
      await db.sequelize.query(
        `
        INSERT INTO ${tableNames.WHATSAPP_TEMPLATE_COMPONENTS}
        (template_id, component_type, text_content)
        VALUES (?, 'carousel', ?)
        `,
        {
          replacements: [template_id, JSON.stringify(components.carousel)],
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
        extractedVariables.set(varKey, variable.sample || variable.value);
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
      (template_id, action, request_payload, response_payload, meta_status)
      VALUES (?, ?, ?, ?, ?)
      `,
      {
        replacements: [
          template_id,
          shouldEditOnMeta ? "edit" : "update",
          metaEditPayload ? JSON.stringify(metaEditPayload) : null,
          metaEditResponse ? JSON.stringify(metaEditResponse.data) : null,
          ensureValidLocalMetaStatus(nextStatus),
        ],
        transaction,
      },
    );

    await transaction.commit();

    // Track usage of gallery asset if used in header
    if (headerMediaAssetId) {
      addTemplateUsageService(headerMediaAssetId, template_id).catch((err) =>
        console.error(
          "[TEMPLATE-UPDATE] Failed to log gallery asset usage:",
          err.message,
        ),
      );
    }

    return {
      template_id,
      template_name: template_name || template.template_name,
      category: category || template.category,
      language: language || template.language,
      status: nextStatus,
      message: "Template updated successfully",
    };
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
};

/**
 * Uses AI to help user generate or fix a template's content
 */
export const generateTemplateContentService = async ({
  tenant_id,
  focus,
  style,
  optimization,
  language = "English",
  prompt,
  previous_content = null,
  rejection_reason = null,
}) => {
  const systemPrompt = getTemplateCopywriterPrompt({
    focus,
    style,
    optimization,
    language,
    previousContent: previous_content,
    rejectionReason: rejection_reason,
  });

  const userPrompt = `User Request: ${prompt}`;

  try {
    const aiResponse = await AiService(
      "system",
      `${systemPrompt}\n\n${userPrompt}`,
      tenant_id,
      "template_content",
    );
    return aiResponse;
  } catch (err) {
    throw new Error(`AI Generation failed: ${err.message}`);
  }
};

/**
 * Retrieves a list of soft-deleted templates for a tenant.
 */
export const getDeletedTemplateListService = async (tenant_id) => {
  try {
    const deletedTemplates = await db.WhatsappTemplates.findAll({
      where: { tenant_id, is_deleted: true },
      order: [["deleted_at", "DESC"]],
      include: [
        {
          model: db.WhatsappTemplateComponents,
          as: "components",
        },
      ],
    });

    return deletedTemplates;
  } catch (err) {
    throw err;
  }
};

const restoreRelatedTemplateRows = async (template_id, transaction = null) => {
  const lifecycleTables = [
    tableNames.WHATSAPP_TEMPLATE_COMPONENTS,
    tableNames.WHATSAPP_TEMPLATE_VARIABLES,
    tableNames.WHATSAPP_TEMPLATE_SYNC_LOGS,
  ];

  for (const tableName of lifecycleTables) {
    const [columns] = await db.sequelize.query(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = DATABASE()
         AND table_name = ?
         AND column_name IN ('is_deleted', 'deleted_at')`,
      { replacements: [tableName], transaction },
    );

    const columnNames = new Set(columns.map((column) => column.column_name));
    if (!columnNames.has("is_deleted") || !columnNames.has("deleted_at")) {
      continue;
    }

    await db.sequelize.query(
      `UPDATE ${tableName}
       SET is_deleted = false,
           deleted_at = NULL
       WHERE template_id = ?`,
      { replacements: [template_id], transaction },
    );
  }
};

/**
 * Restore a soft-deleted template
 */
export const restoreTemplateService = async (template_id, tenant_id) => {
  try {
    return await db.sequelize.transaction(async (transaction) => {
      const template = await db.WhatsappTemplates.findOne({
        where: { template_id, tenant_id, is_deleted: true },
        transaction,
        lock: transaction.LOCK.UPDATE,
      });

      if (!template) {
        throw new Error("Template not found or not deleted");
      }

      const previousStatus = template.previous_status || null;
      const restoredStatus = resolveRestoredTemplateStatus(previousStatus);
      const isDeletedBeforeRestore = template.is_deleted;

      await template.update(
        {
          is_deleted: false,
          deleted_at: null,
          status: restoredStatus,
          previous_status: null,
        },
        { transaction },
      );

      await restoreRelatedTemplateRows(template_id, transaction);

      const restoredTemplate = await db.WhatsappTemplates.findOne({
        where: { template_id, tenant_id, is_deleted: false },
        transaction,
      });

      if (!restoredTemplate) {
        throw new Error("Template restore validation failed");
      }

      logger.info("[Template Restore]", {
        template_id: template.template_id,
        is_deleted_before_restore: isDeletedBeforeRestore,
        is_deleted_after_restore: restoredTemplate.is_deleted,
        previous_status: previousStatus,
        restored_status: restoredStatus,
      });

      return {
        message: "Template restored successfully",
        template_id: template.template_id,
        previous_status: previousStatus,
        restored_status: restoredStatus,
      };
    });
  } catch (err) {
    throw err;
  }
};
