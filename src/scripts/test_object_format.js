import axios from "axios";
import db from "../database/index.js";

const test = async () => {
  try {
    const [account] = await db.sequelize.query(
      `SELECT * FROM whatsapp_accounts WHERE tenant_id = 'TT001' LIMIT 1`,
    );
    const wa = account[0];

    // Try with array of objects instead of flat array
    const payload = {
      name: `test_object_format_${Date.now()}`,
      language: "en",
      category: "UTILITY",
      parameter_format: "positional",
      components: [
        {
          type: "BODY",
          text: "Hello {{1}}, your appointment is on {{2}}.",
          example: {
            body_text: [
              {
                string: "John",
              },
              {
                string: "2026-02-05",
              },
            ],
          },
        },
      ],
    };

    console.log("Testing with object format...");
    console.log(JSON.stringify(payload, null, 2));

    const response = await axios.post(
      `https://graph.facebook.com/v24.0/${wa.waba_id}/message_templates`,
      payload,
      {
        headers: { Authorization: `Bearer ${wa.access_token}` },
      },
    );

    console.log("✅ Object format SUCCESS");
    process.exit(0);
  } catch (err) {
    console.log(
      "❌ Object format FAILED:",
      err.response?.data?.error?.error_user_msg,
    );
    process.exit(1);
  }
};

test();
