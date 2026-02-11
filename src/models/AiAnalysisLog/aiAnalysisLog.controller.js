import {
    createAiAnalysisLogService,
    getAiAnalysisLogsService,
    getAiAnalysisLogByIdService,
    updateAiLogStatusService,
    softDeleteAiAnalysisLogService,
    getDeletedAiAnalysisLogListService,
    restoreAiAnalysisLogService,
    permanentDeleteAiAnalysisLogService,
} from "./aiAnalysisLog.service.js";

export const createAiAnalysisLogController = async (req, res) => {
    try {
        const tenant_id = req.user.tenant_id;
        const data = { ...req.body, tenant_id };

        const result = await createAiAnalysisLogService(data);

        return res.status(201).json({
            message: "Log created successfully",
            data: result,
        });
    } catch (error) {
        return res.status(500).json({
            message: error.message,
        });
    }
};

export const getAiAnalysisLogsController = async (req, res) => {
    try {
        const { type, status, limit, page, search } = req.query;
        const tenant_id = req.user.tenant_id;

        const pageNum = parseInt(page) || 1;
        const limitNum = parseInt(limit) || 10;
        const offset = (pageNum - 1) * limitNum;

        const result = await getAiAnalysisLogsService(
            tenant_id,
            type,
            status,
            limitNum,
            offset,
            search
        );

        return res.status(200).json({
            message: "success",
            ...result
        });
    } catch (error) {
        return res.status(500).json({
            message: error.message,
        });
    }
};

export const getAiAnalysisLogByIdController = async (req, res) => {
    try {
        const { id } = req.params;
        const tenant_id = req.user.tenant_id;

        const result = await getAiAnalysisLogByIdService(id, tenant_id);

        if (!result) {
            return res.status(404).json({ message: "Log not found" });
        }

        return res.status(200).json({
            message: "success",
            data: result,
        });
    } catch (error) {
        return res.status(500).json({
            message: error.message,
        });
    }
};

export const updateAiLogStatusController = async (req, res) => {
    try {
        const { id } = req.params;
        const { status, resolution, type } = req.body;
        const tenant_id = req.user.tenant_id;

        if (!status && !resolution && !type) {
            return res.status(400).json({ message: "Status, resolution, or type is required" });
        }

        const result = await updateAiLogStatusService(
            id,
            status,
            resolution,
            type,
            tenant_id
        );

        return res.status(200).json({
            message: "Log updated successfully",
            data: result,
        });
    } catch (error) {
        return res.status(500).json({
            message: error.message,
        });
    }
};

export const softDeleteAiAnalysisLogController = async (req, res) => {
    try {
        const { id } = req.params;
        const tenant_id = req.user.tenant_id;

        const result = await softDeleteAiAnalysisLogService(id, tenant_id);

        if (!result) {
            return res.status(404).json({ message: "Log not found or already deleted" });
        }

        return res.status(200).json({
            message: "Log moved to trash successfully",
        });
    } catch (error) {
        return res.status(500).json({
            message: error.message,
        });
    }
};

export const getDeletedAiAnalysisLogListController = async (req, res) => {
    try {
        const tenant_id = req.user.tenant_id;
        const result = await getDeletedAiAnalysisLogListService(tenant_id);

        return res.status(200).json({
            message: "success",
            data: result,
        });
    } catch (error) {
        return res.status(500).json({
            message: error.message,
        });
    }
};

export const restoreAiAnalysisLogController = async (req, res) => {
    try {
        const { id } = req.params;
        const tenant_id = req.user.tenant_id;

        const result = await restoreAiAnalysisLogService(id, tenant_id);

        if (!result) {
            return res.status(404).json({ message: "Log not found in trash" });
        }

        return res.status(200).json({
            message: "Log restored successfully",
        });
    } catch (error) {
        return res.status(500).json({
            message: error.message,
        });
    }
};

export const permanentDeleteAiAnalysisLogController = async (req, res) => {
    try {
        const { id } = req.params;
        const tenant_id = req.user.tenant_id;

        const result = await permanentDeleteAiAnalysisLogService(id, tenant_id);

        if (!result) {
            return res.status(404).json({ message: "Log not found" });
        }

        return res.status(200).json({
            message: "Log permanently deleted successfully",
        });
    } catch (error) {
        return res.status(500).json({
            message: error.message,
        });
    }
};
