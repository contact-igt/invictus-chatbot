import {
  createLiveChatService,
  getLivechatByIdService,
  getLiveChatListService,
  getHistoryChatListService,
} from "../LiveChatModel/livechat.service.js";

export const createLiveChatController = async (req, res) => {
  const { contact_id } = req.body;

  const tenant_id = req.user.tenant_id;

  if (!contact_id || !tenant_id) {
    return res.status(400).send({
      message: "Tenant id or contact id missing",
    });
  }

  try {
    const livelist = await getLivechatByIdService(tenant_id, contact_id);

    if (!livelist) {
      await createLiveChatService(tenant_id, contact_id);
    }

    return res.status(200).send({
      message: "success",
    });
  } catch (err) {
    return res.status(500).send({
      message: err?.message,
    });
  }
};

export const getLiveChatListController = async (req, res) => {
  const tenant_id = req.user.tenant_id;

  if (!tenant_id) {
    return res.status(400).send({
      message: "Tenant id missing",
    });
  }

  try {
    const response = await getLiveChatListService(tenant_id);

    return res.status(200).send({
      message: "success",
      data: response,
    });
  } catch (err) {
    return res.status(500).send({
      message: err?.message,
    });
  }
};

export const getHistoryChatListController = async (req, res) => {
  const tenant_id = req.user.tenant_id;

  if (!tenant_id) {
    return res.status(400).send({
      message: "Tenant id missing",
    });
  }

  try {
    const response = await getHistoryChatListService(tenant_id);

    return res.status(200).send({
      message: "success",
      data: response,
    });
  } catch (err) {
    return res.status(500).send({
      message: err?.message,
    });
  }
};
