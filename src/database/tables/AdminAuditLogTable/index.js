import { tableNames } from "../../tableName.js";

export const AdminAuditLogTable = (sequelize, Sequelize) => {
  return sequelize.define(
    tableNames.ADMIN_AUDIT_LOG,
    {
      id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
      },

      admin_id: {
        type: Sequelize.STRING,
        allowNull: false,
        comment: "ID of the admin who performed the action",
      },

      tenant_id: {
        type: Sequelize.STRING,
        allowNull: true,
        comment: "Target tenant, or null for global admin actions",
      },

      action_type: {
        type: Sequelize.ENUM(
          "force_unlock",
          "manual_credit",
          "manual_invoice_close",
          "billing_mode_change",
          "pricing_update",
          "currency_rate_update",
          "tenant_limit_change",
          "credit_limit_change",
          "gst_rate_change",
          "gst_rate_deactivate",
          "gst_rate_delete",
        ),
        allowNull: false,
      },

      details: {
        type: Sequelize.JSON,
        allowNull: true,
        comment: "Action-specific data (amount, invoice_id, reason, etc.)",
      },

      before_state: {
        type: Sequelize.JSON,
        allowNull: true,
        comment: "Snapshot of entity before change",
      },

      after_state: {
        type: Sequelize.JSON,
        allowNull: true,
        comment: "Snapshot of entity after change",
      },

      reason: {
        type: Sequelize.TEXT,
        allowNull: true,
        comment: "Admin-provided justification",
      },

      ip_address: {
        type: Sequelize.STRING,
        allowNull: true,
      },

      user_agent: {
        type: Sequelize.STRING,
        allowNull: true,
      },

      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: sequelize.literal("CURRENT_TIMESTAMP"),
        field: "created_at",
      },
    },
    {
      tableName: tableNames.ADMIN_AUDIT_LOG,
      timestamps: true,
      updatedAt: false,
      underscored: true,
      indexes: [
        {
          name: "idx_admin_audit_tenant",
          fields: ["tenant_id"],
        },
        {
          name: "idx_admin_audit_admin",
          fields: ["admin_id"],
        },
        {
          name: "idx_admin_audit_action",
          fields: ["action_type"],
        },
      ],
    },
  );
};
