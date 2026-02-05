import axios from "axios";
import db from "../database/index.js";

const testMetaToken = async () => {
  try {
    // Get the WhatsApp account
    const [account] = await db.sequelize.query(
      `SELECT * FROM whatsapp_accounts WHERE tenant_id = 'TT001' LIMIT 1`,
    );

    if (!account || account.length === 0) {
      console.error("❌ No WhatsApp account found");
      process.exit(1);
    }

    const whatsappAccount = account[0];

    console.log("\n🔐 Account Info:");
    console.log(`  WABA ID: ${whatsappAccount.waba_id}`);
    console.log(
      `  Access Token (first 30 chars): ${whatsappAccount.access_token?.substring(0, 30)}...`,
    );
    console.log(
      `  Access Token Length: ${whatsappAccount.access_token?.length}`,
    );

    // Test 1: Verify token is valid
    console.log("\n✅ Test 1: Verifying access token...");
    const tokenTest = await axios.get("https://graph.facebook.com/v24.0/me", {
      params: { access_token: whatsappAccount.access_token },
    });
    console.log("✅ Token is VALID");
    console.log(`   User ID: ${tokenTest.data.id}`);
    console.log(`   Name: ${tokenTest.data.name}`);

    // Test 2: Get WABA info
    console.log("\n✅ Test 2: Checking WABA access...");
    const wabaTest = await axios.get(
      `https://graph.facebook.com/v24.0/${whatsappAccount.waba_id}`,
      {
        params: { access_token: whatsappAccount.access_token },
      },
    );
    console.log("✅ WABA is accessible");
    console.log(`   WABA ID: ${wabaTest.data.id}`);
    console.log(`   Name: ${wabaTest.data.name}`);

    // Test 3: Check message_templates endpoint
    console.log("\n✅ Test 3: Checking message_templates endpoint...");
    const templatesTest = await axios.get(
      `https://graph.facebook.com/v24.0/${whatsappAccount.waba_id}/message_templates`,
      {
        params: { access_token: whatsappAccount.access_token },
      },
    );
    console.log("✅ Message templates endpoint is accessible");
    console.log(`   Total templates: ${templatesTest.data.data?.length || 0}`);

    console.log("\n✅ All tests PASSED - Token and account are valid!");
    process.exit(0);
  } catch (err) {
    console.error("\n❌ Test FAILED:");
    console.error(`   Status: ${err.response?.status}`);
    console.error(`   Error: ${err.response?.data?.error?.message}`);
    console.error(`   Details: ${JSON.stringify(err.response?.data, null, 2)}`);
    process.exit(1);
  }
};

testMetaToken();
