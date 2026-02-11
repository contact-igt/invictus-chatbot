import axios from "axios";

export const sendTypingIndicator = async (
  phone_number_id,
  access_token,
  messageId,
) => {
  try {
    await axios.post(
      `https://graph.facebook.com/${process.env.META_API_VERSION}/${phone_number_id}/messages`,
      {
        messaging_product: "whatsapp",
        status: "read",
        message_id: messageId,
        typing_indicator: {
          type: "text",
        },
      },
      {
        headers: {
          Authorization: `Bearer ${access_token}`,
          "Content-Type": "application/json",
        },
      },
    );
  } catch (err) {
    console.error("Typing indicator error:", err.response?.data || err.message);
  }
};
