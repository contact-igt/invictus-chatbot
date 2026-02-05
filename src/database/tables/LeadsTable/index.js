import { tableNames } from "../../tableName.js";

export const LeadsTable = (sequelize, Sequelize) => {
  return sequelize.define(
    tableNames.LEADS,
    {
      tenant_id: {
        type: Sequelize.STRING,
        allowNull: false,
      },

      contact_id: {
        type: Sequelize.STRING,
        allowNull: false,
      },

      score: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },

      heat_state: {
        type: Sequelize.ENUM("hot", "warm", "cold", "supercold"),
        allowNull: false,
        defaultValue: "cold",
      },

      ai_summary: {
        type: Sequelize.TEXT,
        allowNull: true,
      },

      summary_status: {
        type: Sequelize.ENUM("new", "old"),
        allowNull: false,
        defaultValue: "new",
      },

      last_user_message_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },

      last_admin_reply_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },

      status: {
        type: Sequelize.ENUM("active", "archived", "blocked"),
        allowNull: false,
        defaultValue: "active",
      },

      lead_stage: {
        type: Sequelize.ENUM("New", "Contacted", "Qualified", "Negotiation", "Lost", "Won"),
        allowNull: false,
        defaultValue: "New",
        field: "lead_stage",
      },

      assigned_to: {
        type: Sequelize.STRING,
        allowNull: true,
        field: "assigned_to",
      },

      source: {
        type: Sequelize.STRING,
        allowNull: true,
        field: "source",
      },

      priority: {
        type: Sequelize.ENUM("Low", "Medium", "High"),
        allowNull: false,
        defaultValue: "Medium",
        field: "priority",
      },

      internal_notes: {
        type: Sequelize.TEXT,
        allowNull: true,
        field: "internal_notes",
      },

      is_deleted: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },

      deleted_at: {
        type: Sequelize.DATE,
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
        defaultValue: sequelize.literal("CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"),
        field: "updated_at",
      },
    },
    {
      tableName: tableNames.LEADS,
      timestamps: true,
      underscored: true,
      indexes: [
        {
          name: "idx_lead_status",
          fields: ["tenant_id", "status", "is_deleted"],
        },
        {
          name: "idx_lead_heat",
          fields: ["tenant_id", "heat_state", "is_deleted"],
        },
        {
          name: "unique_lead_contact_active",
          unique: true,
          fields: ["contact_id", "is_deleted"],
        },
        {
          name: "idx_lead_last_message",
          fields: ["last_user_message_at"],
        },
        {
          name: "idx_lead_deleted",
          fields: ["is_deleted"],
        },
      ],
    }
  );
};
