import {
  createLiveChatService,
  getLivechatByIdService,
  getLiveChatListService,
  getHistoryChatListService,
  claimLiveChatService,
  assignAgentToLiveChatService,
  getAgentListService,
} from "../LiveChatModel/livechat.service.js";
import { getIO } from "../../middlewares/socket/socket.js";

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

// ─── AGENT ASSIGNMENT CONTROLLERS ────────────────────────────────────────────

/**
 * POST /live-chat/claim
 * Any authenticated tenant role can self-claim a live chat.
 */
export const claimLiveChatController = async (req, res) => {
  const { contact_id } = req.body;
  const tenant_id = req.user.tenant_id;
  const agent_id = req.user.unique_id; // tenant_user_id from JWT

  if (!contact_id) {
    return res.status(400).send({ message: "contact_id is required" });
  }

  try {
    // Ensure chat exists
    const chat = await getLivechatByIdService(tenant_id, contact_id);
    if (!chat) {
      return res.status(404).send({ message: "Live chat not found" });
    }

    if (chat.assigned_admin_id && chat.assigned_admin_id !== agent_id) {
       const agents = await getAgentListService(tenant_id);
       const assignedAgent = agents.find(a => a.tenant_user_id === chat.assigned_admin_id);
       const agentName = assignedAgent ? assignedAgent.username : "another agent";
       return res.status(400).send({ message: `This lead is already claimed by ${agentName}` });
    }

    await claimLiveChatService(tenant_id, contact_id, agent_id);

    const io = getIO();
    io.to(`tenant-${tenant_id}`).emit("chat-assignment-updated", { contact_id, assigned_admin_id: agent_id });

    return res.status(200).send({ message: "Chat claimed successfully" });
  } catch (err) {
    return res.status(500).send({ message: err?.message });
  }
};

/**
 * PUT /live-chat/assign
 * Only tenant_admin can assign an agent to a live chat.
 */
export const assignAgentToLiveChatController = async (req, res) => {
  const { contact_id, agent_id } = req.body;
  const tenant_id = req.user.tenant_id;

  if (!contact_id) {
    return res
      .status(400)
      .send({ message: "contact_id is required" });
  }

  // agent_id can be empty string or null to unassign
  const finalAgentId = agent_id || null;

  try {
    // Ensure chat exists
    const chat = await getLivechatByIdService(tenant_id, contact_id);
    if (!chat) {
      return res.status(404).send({ message: "Live chat not found" });
    }

    await assignAgentToLiveChatService(tenant_id, contact_id, finalAgentId);

    const io = getIO();
    io.to(`tenant-${tenant_id}`).emit("chat-assignment-updated", { contact_id, assigned_admin_id: finalAgentId });

    return res.status(200).send({ message: "Agent assigned successfully" });
  } catch (err) {
    return res.status(500).send({ message: err?.message });
  }
};

/**
 * GET /live-chats/agents
 * Returns the list of assignable agents for the admin dropdown.
 * Only accessible by tenant_admin.
 */
export const getAgentListController = async (req, res) => {
  const tenant_id = req.user.tenant_id;

  try {
    const agents = await getAgentListService(tenant_id);

    return res.status(200).send({
      message: "success",
      data: agents,
    });
  } catch (err) {
    return res.status(500).send({ message: err?.message });
  }
};
