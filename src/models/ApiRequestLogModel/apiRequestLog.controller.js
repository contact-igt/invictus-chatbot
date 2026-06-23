import { getApiRequestLogsService } from "./apiRequestLog.service.js";

export const getApiRequestLogsController = async (req, res) => {
  try {
    const data = await getApiRequestLogsService();

    return res.status(200).json({
      success: true,
      message: "API request logs fetched successfully",
      data,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: "Failed to fetch API request logs",
    });
  }
};
