import axios from "axios";
import db from "../database/index.js";

const testCorrectFormat = async () => {
  try {
    const [account] = await db.sequelize.query(
      `SELECT * FROM whatsapp_accounts WHERE tenant_id = 'TT001' LIMIT 1`,
    );

    const whatsappAccount = account[0];

    // According to Meta docs, when you have HEADER with TEXT format, you need example with header_text
    const correctPayload = {
      name: `test_correct_format_${Date.now()}`,
      language: "en",
      category: "UTILITY",
      parameter_format: "positional",
      components: [
        {
          type: "HEADER",
          format: "TEXT",
          text: "Appointment Reminder",
          example: {
            header_text: ["Appointment Reminder"],
          },
        },
        {
          type: "BODY",
          text: "Hello {{1}}, your appointment is on {{2}} at {{3}}.",
          example: {
            body_text: ["John", "2026-02-05", "10:30 AM"],
          },
        },
      ],
    };

    console.log("📤 Testing CORRECT format with HEADER example...\n");
    console.log(JSON.stringify(correctPayload, null, 2));
    console.log("\n");

    const response = await axios.post(
      `https://graph.facebook.com/v24.0/${whatsappAccount.waba_id}/message_templates`,
      correctPayload,
      {
        headers: {
          Authorization: `Bearer ${whatsappAccount.access_token}`,
          "Content-Type": "application/json",
        },
      },
    );

    console.log("✅ SUCCESS! Template created:");
    console.log(`   Template ID: ${response.data.id}`);
    console.log(`   Status: ${response.data.status}`);
    process.exit(0);
  } catch (err) {
    console.error("❌ Failed:");
    console.error(`   Error: ${err.response?.data?.error?.error_user_msg}`);
    console.error(JSON.stringify(err.response?.data, null, 2));
    process.exit(1);
  }
};

testCorrectFormat();
