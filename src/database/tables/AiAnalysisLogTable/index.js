import { tableNames } from "../../tableName.js";

export const AiAnalysisLogTable = (sequelize, Sequelize) => {
  const { DataTypes } = Sequelize;

  const AiAnalysisLog = sequelize.define(
    tableNames.AI_ANALYSIS_LOGS,
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      tenant_id: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      type: {
        type: DataTypes.ENUM(
          "missing_knowledge",
          "out_of_scope",
          "urgent",
          "sentiment",
        ),
        allowNull: false,
      },
      payload: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: "Stores extra data like reasoning, scores, etc.",
      },
      user_message: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      ai_response: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: "The cleaned response sent to the user",
      },
      status: {
        type: DataTypes.ENUM("pending", "act_on", "resolved", "ignored"),
        defaultValue: "pending",
      },
      resolution: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: "The correct answer or action taken by admin",
      },
      is_deleted: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
      },
      deleted_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },

    {
      tableName: tableNames.AI_ANALYSIS_LOGS,
      timestamps: true,
      underscored: true,
      indexes: [
        {
          name: "idx_ai_log_tenant",
          fields: ["tenant_id"],
        },
        {
          name: "idx_ai_log_type",
          fields: ["type"],
        },
        {
          name: "idx_ai_log_deleted",
          fields: ["is_deleted"],
        },
      ],
    },
  );

  return AiAnalysisLog;
};
