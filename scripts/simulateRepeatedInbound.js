/**
 * Fire N synthetic Meta "messages" webhooks at a locally-running backend to
 * exercise the Repeated User Message → AI Handoff guard without touching Meta.
 *
 *   node scripts/simulateRepeatedInbound.js "Otp 360390" 5
 *
 * Optional env:
 *   SIM_URL   default http://localhost:8000/api/whatsapp/webhook/TT001
 *   SIM_PNID  phone_number_id, default 1101776276342526  (TT001 stage number)
 *   SIM_FROM  customer phone (E.164 no +), default 919999900001
 */
const text = process.argv[2] || "Otp 360390";
const count = Number(process.argv[3] || 5);
const URL = process.env.SIM_URL || "http://localhost:8000/api/whatsapp/webhook/TT001";
const PNID = process.env.SIM_PNID || "1101776276342526";
const FROM = process.env.SIM_FROM || "919999900001";

const buildBody = (i) => ({
  object: "whatsapp_business_account",
  entry: [
    {
      id: "980772624279240",
      changes: [
        {
          field: "messages",
          value: {
            messaging_product: "whatsapp",
            metadata: { display_phone_number: "9361824559", phone_number_id: PNID },
            contacts: [{ profile: { name: "Sim Tester" }, wa_id: FROM }],
            messages: [
              {
                from: FROM,
                id: `wamid.SIM-${Date.now()}-${i}`,
                timestamp: String(Math.floor(Date.now() / 1000)),
                type: "text",
                text: { body: text },
              },
            ],
          },
        },
      ],
    },
  ],
});

const run = async () => {
  for (let i = 1; i <= count; i++) {
    const res = await fetch(URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildBody(i)),
    });
    console.log(`#${i} -> HTTP ${res.status}`);
    await new Promise((r) => setTimeout(r, 1500)); // let each finish processing
  }
  console.log("done — check the backend console for [REPEAT-GUARD] lines");
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
