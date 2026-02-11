import db from "../../database/index.js";
import { Op } from "sequelize";

export const createAiAnalysisLogService = async (data) => {
    try {
        const log = await db.AiAnalysisLog.create(data);
        return log;
    } catch (error) {
        throw new Error(`Error creating AI log: ${error.message}`);
    }
};

export const getAiAnalysisLogsService = async (
    tenant_id,
    type,
    status,
    limit = 10,
    offset = 0,
    search = ""
) => {
    try {
        const whereClause = {
            tenant_id,
            is_deleted: false
        };

        if (type) whereClause.type = type;
        if (status) whereClause.status = status;

        if (search) {
            whereClause[Op.or] = [
                { user_message: { [Op.like]: `%${search}%` } },
                { ai_response: { [Op.like]: `%${search}%` } }
            ];
        }

        const { count, rows } = await db.AiAnalysisLog.findAndCountAll({
            where: whereClause,
            limit: parseInt(limit),
            offset: parseInt(offset),
            order: [["created_at", "DESC"]],
        });

        return {
            total: count,
            page: Math.floor(offset / limit) + 1,
            limit: parseInt(limit),
            data: rows
        };
    } catch (error) {
        throw new Error(`Error fetching AI logs: ${error.message}`);
    }
};

export const getAiAnalysisLogByIdService = async (id, tenant_id) => {
    try {
        const log = await db.AiAnalysisLog.findOne({
            where: { id, tenant_id, is_deleted: false },
        });
        return log;
    } catch (error) {
        throw new Error(`Error fetching AI log by ID: ${error.message}`);
    }
};

export const updateAiLogStatusService = async (
    id,
    status,
    resolution,
    type,
    tenant_id
) => {
    try {
        const log = await db.AiAnalysisLog.findByPk(id);

        if (!log) {
            throw new Error("Log entry not found");
        }

        if (log.tenant_id !== tenant_id) {
            throw new Error("Unauthorized: This log belongs to another tenant");
        }

        if (log.is_deleted) {
            throw new Error("Cannot update a log that is in trash");
        }

        if (status) {
            const validStatuses = ["pending", "act_on", "resolved", "ignored"];
            const lowerStatus = status.toLowerCase();
            if (!validStatuses.includes(lowerStatus)) {
                throw new Error(`Invalid status. Allowed: ${validStatuses.join(", ")}`);
            }
            log.status = lowerStatus;
        }

        if (type) {
            const validTypes = ["missing_knowledge", "out_of_scope", "urgent", "sentiment"];
            const lowerType = type.toLowerCase();
            if (!validTypes.includes(lowerType)) {
                throw new Error(`Invalid type. Allowed: ${validTypes.join(", ")}`);
            }
            log.type = lowerType;
        }

        if (resolution) log.resolution = resolution;

        await log.save();

        return log;
    } catch (error) {
        throw new Error(`Error updating log status: ${error.message}`);
    }
};

export const softDeleteAiAnalysisLogService = async (id, tenant_id) => {
    try {
        const log = await db.AiAnalysisLog.findOne({
            where: { id, tenant_id, is_deleted: false },
        });

        if (!log) return null;

        log.is_deleted = true;
        log.deleted_at = new Date();
        await log.save();

        return log;
    } catch (error) {
        throw new Error(`Error soft deleting AI log: ${error.message}`);
    }
};

export const getDeletedAiAnalysisLogListService = async (tenant_id) => {
    try {
        const rows = await db.AiAnalysisLog.findAll({
            where: { tenant_id, is_deleted: true },
            order: [["deleted_at", "DESC"]],
        });
        return rows;
    } catch (error) {
        throw new Error(`Error fetching deleted AI logs: ${error.message}`);
    }
};

export const restoreAiAnalysisLogService = async (id, tenant_id) => {
    try {
        const log = await db.AiAnalysisLog.findOne({
            where: { id, tenant_id, is_deleted: true },
        });

        if (!log) return null;

        log.is_deleted = false;
        log.deleted_at = null;
        await log.save();

        return log;
    } catch (error) {
        throw new Error(`Error restoring AI log: ${error.message}`);
    }
};

export const permanentDeleteAiAnalysisLogService = async (id, tenant_id) => {
    try {
        const result = await db.AiAnalysisLog.destroy({
            where: { id, tenant_id },
        });
        return result;
    } catch (error) {
        throw new Error(`Error permanently deleting AI log: ${error.message}`);
    }
};
