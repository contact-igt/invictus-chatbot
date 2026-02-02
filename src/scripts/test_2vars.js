import axios from "axios";
import db from "../database/index.js";

const test = async () => {
  try {
    const [account] = await db.sequelize.query(
      `SELECT * FROM whatsapp_accounts WHERE tenant_id = 'TT001' LIMIT 1`,
    );
    const wa = account[0];

    // Test with 2 variables
    const payload = {
      name: `test_2vars_${Date.now()}`,
      language: "en",
      category: "UTILITY",
      parameter_format: "positional",
      components: [
        {
          type: "BODY",
          text: "Hello {{1}}, your appointment is on {{2}}.",
          example: {
            body_text: ["John", "2026-02-05"],
          },
        },
      ],
    };

    const response = await axios.post(
      `https://graph.facebook.com/v24.0/${wa.waba_id}/message_templates`,
      payload,
      {
        headers: { Authorization: `Bearer ${wa.access_token}` },
      },
    );

    console.log("✅ 2 variables SUCCESS");
    process.exit(0);
  } catch (err) {
    console.log(
      "❌ 2 variables FAILED:",
      err.response?.data?.error?.error_user_msg,
    );
    process.exit(1);
  }
};

test();
