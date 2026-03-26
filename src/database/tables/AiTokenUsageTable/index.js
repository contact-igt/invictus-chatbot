import { tableNames } from "../../tableName.js";

export const AiTokenUsageTable = (sequelize, Sequelize) => {
  return sequelize.define(
    tableNames.AI_TOKEN_USAGE,
    {
      id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
      },

      tenant_id: {
        type: Sequelize.STRING,
        allowNull: false,
      },

      model: {
        type: Sequelize.STRING,
        allowNull: false,
        comment: "AI model used (e.g., gpt-4o, gpt-4o-mini)",
      },

      source: {
        type: Sequelize.STRING,
        allowNull: false,
        comment:
          "Where the call originated (whatsapp, playground, classifier, knowledge, language_detect)",
      },

      prompt_tokens: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },

      completion_tokens: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },

      total_tokens: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },

      estimated_cost: {
        type: Sequelize.DECIMAL(10, 6),
        allowNull: false,
        defaultValue: 0,
        comment: "Estimated cost in USD",
      },

      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: sequelize.literal("CURRENT_TIMESTAMP"),
        field: "created_at",
      },

      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: sequelize.literal("CURRENT_TIMESTAMP"),
        field: "updated_at",
      },
    },
    {
      tableName: tableNames.AI_TOKEN_USAGE,
      timestamps: true,
      underscored: true,
      indexes: [
        {
          name: "idx_ai_token_usage_tenant",
          fields: ["tenant_id"],
        },
        {
          name: "idx_ai_token_usage_created",
          fields: ["created_at"],
        },
        {
          name: "idx_ai_token_usage_source",
          fields: ["source"],
        },
      ],
    },
  );
};
