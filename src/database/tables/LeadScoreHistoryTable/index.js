import { tableNames } from "../../tableName.js";

export const LeadScoreHistoryTable = (sequelize, Sequelize) => {
  return sequelize.define(
    tableNames.LEAD_SCORE_HISTORY,
    {
      id: {
        type: Sequelize.BIGINT.UNSIGNED,
        autoIncrement: true,
        primaryKey: true,
      },

      tenant_id: {
        type: Sequelize.STRING,
        allowNull: false,
      },

      contact_id: {
        type: Sequelize.STRING,
        allowNull: false,
      },

      lead_id: {
        type: Sequelize.STRING,
        allowNull: false,
      },

      previous_final_score: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },

      raw_score: {
        type: Sequelize.DECIMAL(5, 2),
        allowNull: false,
        defaultValue: 0,
      },

      recency_component: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },

      intent_component: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 50,
      },

      conversation_component: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 50,
      },

      intent_interest_component: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 50,
      },

      confidence: {
        type: Sequelize.DECIMAL(4, 2),
        allowNull: false,
        defaultValue: 0.5,
      },

      final_score: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },

      final_status: {
        type: Sequelize.ENUM("hot", "warm", "cold", "supercold"),
        allowNull: false,
        defaultValue: "cold",
      },

      reason_codes: {
        type: Sequelize.JSON,
        allowNull: true,
      },

      source_event: {
        type: Sequelize.STRING,
        allowNull: false,
        defaultValue: "unknown",
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
      tableName: tableNames.LEAD_SCORE_HISTORY,
      timestamps: true,
      underscored: true,
      indexes: [
        {
          name: "idx_lead_score_history_lookup",
          fields: ["tenant_id", "lead_id", "created_at"],
        },
        {
          name: "idx_lead_score_history_contact",
          fields: ["tenant_id", "contact_id", "created_at"],
        },
      ],
    },
  );
};
