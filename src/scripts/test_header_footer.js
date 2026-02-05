import axios from "axios";
import db from "../database/index.js";

const testWithHeader = async () => {
  try {
    const [account] = await db.sequelize.query(
      `SELECT * FROM whatsapp_accounts WHERE tenant_id = 'TT001' LIMIT 1`,
    );

    const whatsappAccount = account[0];

    // Test with HEADER + BODY
    const payloadWithHeader = {
      name: `test_with_header_${Date.now()}`,
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
          text: "Hello {{1}}, your appointment is on {{2}} at {{3}}. Please arrive early.",
          example: {
            body_text: ["John", "2026-02-05", "10:30 AM"],
          },
        },
      ],
    };

    console.log("📤 Testing HEADER + BODY payload...");
    const response = await axios.post(
      `https://graph.facebook.com/v24.0/${whatsappAccount.waba_id}/message_templates`,
      payloadWithHeader,
      {
        headers: {
          Authorization: `Bearer ${whatsappAccount.access_token}`,
          "Content-Type": "application/json",
        },
      },
    );

    console.log("✅ SUCCESS with HEADER + BODY!");
    console.log(`   Template ID: ${response.data.id}`);
    process.exit(0);
  } catch (err) {
    console.error("❌ Failed with HEADER + BODY");
    console.error(err.response?.data?.error?.error_user_msg);

    // Now test with HEADER + BODY + FOOTER
    console.log("\n📤 Testing HEADER + BODY + FOOTER payload...");

    try {
      const [account] = await db.sequelize.query(
        `SELECT * FROM whatsapp_accounts WHERE tenant_id = 'TT001' LIMIT 1`,
      );
      const whatsappAccount = account[0];

      const fullPayload = {
        name: `test_full_${Date.now()}`,
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
            text: "Hello {{1}}, your appointment is on {{2}} at {{3}}. Please arrive early.",
            example: {
              body_text: ["John", "2026-02-05", "10:30 AM"],
            },
          },
          {
            type: "FOOTER",
            text: "Thank you for choosing our service",
          },
        ],
      };

      const response2 = await axios.post(
        `https://graph.facebook.com/v24.0/${whatsappAccount.waba_id}/message_templates`,
        fullPayload,
        {
          headers: {
            Authorization: `Bearer ${whatsappAccount.access_token}`,
            "Content-Type": "application/json",
          },
        },
      );

      console.log("✅ SUCCESS with HEADER + BODY + FOOTER!");
      console.log(`   Template ID: ${response2.data.id}`);
      process.exit(0);
    } catch (err2) {
      console.error("❌ Failed with HEADER + BODY + FOOTER");
      console.error(err2.response?.data?.error?.error_user_msg);
      process.exit(1);
    }
  }
};

testWithHeader();
