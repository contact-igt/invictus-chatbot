import { getChatStateListService } from "./chatState.service.js";

export const getChatStateList = async (req, res) => {
  const tenant_id = req.user.tenant_id;

  if (!tenant_id) {
    return res.status(400).send({ message: "Invalid tenant context" });
  }

  try {
    const resposne = await getChatStateListService(tenant_id);

    return res.status(200).json({
      message: "success",
      data: resposne,
    });
  } catch (err) {
    return res.status(500).json({
      message: err?.message,
    });
  }
};
