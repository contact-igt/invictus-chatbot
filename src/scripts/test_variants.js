import axios from "axios";
import db from "../database/index.js";

const testVariants = async () => {
  try {
    const [account] = await db.sequelize.query(
      `SELECT * FROM whatsapp_accounts WHERE tenant_id = 'TT001' LIMIT 1`,
    );

    const whatsappAccount = account[0];

    // Variant 1: HEADER without example field at all
    const variants = [
      {
        name: "HEADER (no example field) + BODY",
        payload: {
          name: `test_v1_${Date.now()}`,
          language: "en",
          category: "UTILITY",
          parameter_format: "positional",
          components: [
            {
              type: "HEADER",
              format: "TEXT",
              text: "Appointment Reminder",
            },
            {
              type: "BODY",
              text: "Hello {{1}}, your appointment is on {{2}} at {{3}}.",
              example: {
                body_text: ["John", "2026-02-05", "10:30 AM"],
              },
            },
          ],
        },
      },
      {
        name: "BODY only (no variables in HEADER)",
        payload: {
          name: `test_v2_${Date.now()}`,
          language: "en",
          category: "UTILITY",
          parameter_format: "positional",
          components: [
            {
              type: "BODY",
              text: "Hello {{1}}, your appointment is {{2}} at {{3}}. {{4}} confirmed by {{5}}.",
              example: {
                body_text: [
                  "John",
                  "on 2026-02-05",
                  "10:30 AM",
                  "invictus",
                  "global tech",
                ],
              },
            },
          ],
        },
      },
    ];

    for (const variant of variants) {
      console.log(`\n🔍 Testing: ${variant.name}`);
      try {
        const response = await axios.post(
          `https://graph.facebook.com/v24.0/${whatsappAccount.waba_id}/message_templates`,
          variant.payload,
          {
            headers: {
              Authorization: `Bearer ${whatsappAccount.access_token}`,
              "Content-Type": "application/json",
            },
          },
        );
        console.log(`✅ SUCCESS! Template ID: ${response.data.id}`);
      } catch (err) {
        console.log(`❌ Failed: ${err.response?.data?.error?.error_user_msg}`);
      }
    }

    process.exit(0);
  } catch (err) {
    console.error("Fatal error:", err.message);
    process.exit(1);
  }
};

testVariants();
