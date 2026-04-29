import { tableNames } from "../../tableName.js";

export const MessageUnderstandingTable = (sequelize, Sequelize) => {
  return sequelize.define(
    tableNames.MESSAGE_UNDERSTANDING,
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
        allowNull: true,
      },

      message_id: {
        type: Sequelize.BIGINT.UNSIGNED,
        allowNull: true,
      },

      source: {
        type: Sequelize.ENUM("classifier", "manual", "backfill"),
        allowNull: false,
        defaultValue: "classifier",
      },

      summary: {
        type: Sequelize.TEXT,
        allowNull: true,
      },

      primary_intent: {
        type: Sequelize.STRING,
        allowNull: false,
        defaultValue: "GENERAL_QUESTION",
      },

      buying_signal_score: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },

      clarity_score: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },

      conversation_lead_score: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },

      intent_interest_score: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },

      timeline_mentioned: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },

      budget_mentioned: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },

      authority_mentioned: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },

      use_case: {
        type: Sequelize.TEXT,
        allowNull: true,
      },

      timeline: {
        type: Sequelize.STRING,
        allowNull: true,
      },

      budget: {
        type: Sequelize.STRING,
        allowNull: true,
      },

      confidence: {
        type: Sequelize.DECIMAL(4, 2),
        allowNull: false,
        defaultValue: 0.5,
      },

      negative_not_interested: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },

      negative_irrelevant: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },

      raw_payload: {
        type: Sequelize.JSON,
        allowNull: true,
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
      tableName: tableNames.MESSAGE_UNDERSTANDING,
      timestamps: true,
      underscored: true,
      indexes: [
        {
          name: "idx_message_understanding_contact",
          fields: ["tenant_id", "contact_id", "created_at"],
        },
        {
          name: "idx_message_understanding_lead",
          fields: ["tenant_id", "lead_id", "created_at"],
        },
        {
          name: "uq_message_understanding_message",
          unique: true,
          fields: ["tenant_id", "message_id"],
        },
      ],
    },
  );
};
