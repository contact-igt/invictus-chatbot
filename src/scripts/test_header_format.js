import axios from "axios";
import db from "../database/index.js";

const testHeaderFormat = async () => {
  try {
    const [account] = await db.sequelize.query(
      `SELECT * FROM whatsapp_accounts WHERE tenant_id = 'TT001' LIMIT 1`,
    );

    const whatsappAccount = account[0];

    // Test different HEADER format
    console.log("🔍 Testing different HEADER format...\n");

    const payload1 = {
      name: `test_header_v1_${Date.now()}`,
      language: "en",
      category: "UTILITY",
      parameter_format: "positional",
      components: [
        {
          type: "HEADER",
          format: "TEXT",
          text: "Appointment Reminder",
          example: {
            header_text: [""],
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

    console.log("Test 1: HEADER with empty example");
    try {
      const response = await axios.post(
        `https://graph.facebook.com/v24.0/${whatsappAccount.waba_id}/message_templates`,
        payload1,
        {
          headers: {
            Authorization: `Bearer ${whatsappAccount.access_token}`,
            "Content-Type": "application/json",
          },
        },
      );
      console.log("✅ SUCCESS!\n");
      process.exit(0);
    } catch (err) {
      console.log(`❌ Failed: ${err.response?.data?.error?.error_user_msg}\n`);
    }

    // Test 2: Without HEADER example
    const payload2 = {
      name: `test_header_v2_${Date.now()}`,
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
    };

    console.log("Test 2: HEADER without example");
    try {
      const response = await axios.post(
        `https://graph.facebook.com/v24.0/${whatsappAccount.waba_id}/message_templates`,
        payload2,
        {
          headers: {
            Authorization: `Bearer ${whatsappAccount.access_token}`,
            "Content-Type": "application/json",
          },
        },
      );
      console.log("✅ SUCCESS!\n");
      process.exit(0);
    } catch (err) {
      console.log(`❌ Failed: ${err.response?.data?.error?.error_user_msg}\n`);
    }

    // Test 3: BODY text without brackets
    const payload3 = {
      name: `test_header_v3_${Date.now()}`,
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
    };

    console.log("Test 3: Simple HEADER + BODY (retry)");
    try {
      const response = await axios.post(
        `https://graph.facebook.com/v24.0/${whatsappAccount.waba_id}/message_templates`,
        payload3,
        {
          headers: {
            Authorization: `Bearer ${whatsappAccount.access_token}`,
            "Content-Type": "application/json",
          },
        },
      );
      console.log("✅ SUCCESS!\n");
      process.exit(0);
    } catch (err) {
      console.log(`❌ Failed: ${err.response?.data?.error?.error_user_msg}\n`);
      console.error(JSON.stringify(err.response?.data, null, 2));
      process.exit(1);
    }
  } catch (err) {
    console.error("Fatal error:", err.message);
    process.exit(1);
  }
};

testHeaderFormat();
