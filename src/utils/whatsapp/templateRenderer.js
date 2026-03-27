import db from "../../database/index.js";
import { tableNames } from "../../database/tableName.js";

/**
 * Renders a full WhatsApp template message content for chat history.
 * @param {string} template_id - The internal template ID.
 * @param {Array} dynamicComponents - The components array from the request (parameters, media URLs).
 * @returns {Promise<string>} - The human-readable rendered content.
 */
export const renderTemplateContent = async (
  template_id,
  dynamicComponents = [],
) => {
  try {
    // 1. Fetch Template Components from DB
    // Note: QueryTypes.SELECT returns results directly without metadata wrapper
    const components = await db.sequelize.query(
      `SELECT component_type, header_format, text_content, media_url 
       FROM ${tableNames.WHATSAPP_TEMPLATE_COMPONENTS} 
       WHERE template_id = ?`,
      { replacements: [template_id], type: db.Sequelize.QueryTypes.SELECT },
    );

    if (!components || components.length === 0) {
      return "";
    }

    let messageContent = "";

    // 2. Identify Components
    const header = components.find((c) => c.component_type === "header");
    const body = components.find((c) => c.component_type === "body");
    const footer = components.find((c) => c.component_type === "footer");
    const buttonsComp = components.find((c) => c.component_type === "buttons");

    // 3. Render Header
    if (header) {
      if (header.header_format === "text" && header.text_content) {
        let headerText = header.text_content;
        const headerParams =
          dynamicComponents?.find((c) => c.type === "header")?.parameters || [];
        headerParams.forEach((param, index) => {
          if (param.type === "text") {
            headerText = headerText.replace(
              new RegExp(`\\{\\{${index + 1}\\}\\}`, "g"),
              param.text,
            );
          }
        });
        messageContent += headerText + "\n";
      } else if (header.header_format === "location") {
        // Location Header
        const headerComp = dynamicComponents?.find((c) => c.type === "header");
        const loc = headerComp?.parameters?.[0]?.location;
        if (loc?.name) {
          messageContent += `[LOCATION: ${loc.name}${loc.address ? ` - ${loc.address}` : ""}]\n`;
        } else {
          messageContent += `[LOCATION]\n`;
        }
      } else if (header.header_format && header.header_format !== "text") {
        // Media Header (IMAGE, VIDEO, DOCUMENT)
        const format = header.header_format.toUpperCase();
        const headerComp = dynamicComponents?.find((c) => c.type === "header");

        // Extract URL from dynamic params if available, else use fallback from DB
        let mediaUrl = "";
        if (headerComp?.parameters?.[0]) {
          const p = headerComp.parameters[0];
          mediaUrl =
            p.image?.link ||
            p.video?.link ||
            p.document?.link ||
            p.file?.link ||
            "";
        }

        if (!mediaUrl) mediaUrl = header.media_url || "";

        messageContent += `[${format}${mediaUrl ? `: ${mediaUrl}` : ""}]\n`;
      }
    }

    // 4. Render Body
    if (body && body.text_content) {
      let bodyText = body.text_content;
      const bodyParams =
        dynamicComponents?.find((c) => c.type === "body")?.parameters || [];
      bodyParams.forEach((param, index) => {
        if (param.type === "text") {
          bodyText = bodyText.replace(
            new RegExp(`\\{\\{${index + 1}\\}\\}`, "g"),
            param.text,
          );
        }
      });
      messageContent += bodyText;
    }

    // 5. Render Footer
    if (footer && footer.text_content) {
      messageContent += "\n" + footer.text_content;
    }

    // 6. Render Buttons
    if (buttonsComp && buttonsComp.text_content) {
      try {
        const buttons = JSON.parse(buttonsComp.text_content);
        if (Array.isArray(buttons)) {
          buttons.forEach((btn, index) => {
            let btnText = btn.text;

            // Handle Dynamic URL Buttons
            if (btn.type === "URL" && btn.url && btn.url.includes("{{1}}")) {
              const btnParams =
                dynamicComponents?.find(
                  (c) =>
                    c.type === "button" && String(c.index) === String(index),
                )?.parameters || [];
              if (btnParams?.[0]?.text) {
                // Replace {{1}} with actual value to form complete URL
                const resolvedUrl = btn.url.replace("{{1}}", btnParams[0].text);
                btnText += ` (${resolvedUrl})`;
              }
            } else if (btn.type === "URL" && btn.url) {
              // Static URL button
              btnText += ` (${btn.url})`;
            } else if (btn.type === "PHONE_NUMBER" && btn.phone_number) {
              btnText += ` (${btn.phone_number})`;
            }

            messageContent += `\n[Button: ${btnText}]`;
          });
        }
      } catch (e) {
        // Silently fail if JSON parsing fails
      }
    }

    return messageContent.trim();
  } catch (err) {
    console.error("Error in renderTemplateContent:", err);
    return "";
  }
};
