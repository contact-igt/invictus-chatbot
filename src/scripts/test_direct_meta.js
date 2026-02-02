import axios from "axios";
import db from "../database/index.js";

const testDirectMetaSubmission = async () => {
  try {
    const [account] = await db.sequelize.query(
      `SELECT * FROM whatsapp_accounts WHERE tenant_id = 'TT001' LIMIT 1`,
    );

    const whatsappAccount = account[0];

    // Minimal test payload - body only, 1 variable
    const minimalPayload = {
      name: `test_minimal_${Date.now()}`,
      language: "en",
      category: "UTILITY",
      parameter_format: "positional",
      components: [
        {
          type: "BODY",
          text: "Hello {{1}}, thank you for your business.",
          example: {
            body_text: ["John"],
          },
        },
      ],
    };

    console.log("📤 Sending MINIMAL payload to Meta:");
    console.log(JSON.stringify(minimalPayload, null, 2));

    const response = await axios.post(
      `https://graph.facebook.com/v24.0/${whatsappAccount.waba_id}/message_templates`,
      minimalPayload,
      {
        headers: {
          Authorization: `Bearer ${whatsappAccount.access_token}`,
          "Content-Type": "application/json",
        },
      },
    );

    console.log("\n✅ SUCCESS! Template created:");
    console.log(`   Template ID: ${response.data.id}`);
    console.log(`   Status: ${response.data.status}`);
    process.exit(0);
  } catch (err) {
    console.error("\n❌ Failed to create template:");
    console.error(`   Status: ${err.response?.status}`);
    console.error(`   Message: ${err.response?.data?.error?.error_user_msg}`);
    console.error(
      `   Full Error:`,
      JSON.stringify(err.response?.data, null, 2),
    );
    process.exit(1);
  }
};

testDirectMetaSubmission();
