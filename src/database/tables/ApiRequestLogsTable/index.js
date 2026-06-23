import { tableNames } from "../../tableName.js";

export const ApiRequestLogsTable = (sequelize, Sequelize) => {
  return sequelize.define(
    tableNames.API_REQUEST_LOGS,
    {
      id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
      },
      request_id: {
        type: Sequelize.STRING(80),
        allowNull: false,
      },
      tenant_id: {
        type: Sequelize.STRING(50),
        allowNull: true,
      },
      user_id: {
        type: Sequelize.STRING(50),
        allowNull: true,
      },
      actor_type: {
        type: Sequelize.STRING(30),
        allowNull: true,
      },
      actor_name: {
        type: Sequelize.STRING(255),
        allowNull: true,
      },
      actor_email: {
        type: Sequelize.STRING(255),
        allowNull: true,
      },
      actor_role: {
        type: Sequelize.STRING(50),
        allowNull: true,
      },
      user_type: {
        type: Sequelize.STRING(30),
        allowNull: true,
      },
      method: {
        type: Sequelize.STRING(12),
        allowNull: false,
      },
      original_url: {
        type: Sequelize.TEXT,
        allowNull: false,
      },
      route_path: {
        type: Sequelize.STRING(255),
        allowNull: true,
      },
      module: {
        type: Sequelize.STRING(100),
        allowNull: true,
      },
      status_code: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },
      success: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      duration_ms: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },
      ip_address: {
        type: Sequelize.STRING(100),
        allowNull: true,
      },
      forwarded_for: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      country: {
        type: Sequelize.STRING(100),
        allowNull: true,
      },
      region: {
        type: Sequelize.STRING(100),
        allowNull: true,
      },
      city: {
        type: Sequelize.STRING(100),
        allowNull: true,
      },
      latitude: {
        type: Sequelize.STRING(50),
        allowNull: true,
      },
      longitude: {
        type: Sequelize.STRING(50),
        allowNull: true,
      },
      timezone: {
        type: Sequelize.STRING(100),
        allowNull: true,
      },
      isp: {
        type: Sequelize.STRING(255),
        allowNull: true,
      },
      user_agent: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      browser: {
        type: Sequelize.STRING(100),
        allowNull: true,
      },
      browser_version: {
        type: Sequelize.STRING(50),
        allowNull: true,
      },
      os: {
        type: Sequelize.STRING(100),
        allowNull: true,
      },
      os_version: {
        type: Sequelize.STRING(50),
        allowNull: true,
      },
      device_type: {
        type: Sequelize.STRING(50),
        allowNull: true,
      },
      device_vendor: {
        type: Sequelize.STRING(100),
        allowNull: true,
      },
      device_model: {
        type: Sequelize.STRING(100),
        allowNull: true,
      },
      referer: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      origin: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      accept_language: {
        type: Sequelize.STRING(255),
        allowNull: true,
      },
      query_json: {
        type: Sequelize.JSON,
        allowNull: true,
      },
      body_keys_json: {
        type: Sequelize.JSON,
        allowNull: true,
      },
      metadata_json: {
        type: Sequelize.JSON,
        allowNull: true,
      },
      error_message: {
        type: Sequelize.TEXT,
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
      tableName: tableNames.API_REQUEST_LOGS,
      timestamps: true,
      underscored: true,
      indexes: [
        {
          name: "idx_api_request_logs_request_id",
          fields: ["request_id"],
        },
        {
          name: "idx_api_request_logs_tenant_id",
          fields: ["tenant_id"],
        },
        {
          name: "idx_api_request_logs_user_id",
          fields: ["user_id"],
        },
        {
          name: "idx_api_request_logs_actor_type",
          fields: ["actor_type"],
        },
        {
          name: "idx_api_request_logs_module",
          fields: ["module"],
        },
        {
          name: "idx_api_request_logs_method",
          fields: ["method"],
        },
        {
          name: "idx_api_request_logs_status_code",
          fields: ["status_code"],
        },
        {
          name: "idx_api_request_logs_success",
          fields: ["success"],
        },
        {
          name: "idx_api_request_logs_created_at",
          fields: ["created_at"],
        },
        {
          name: "idx_api_request_logs_tenant_created_at",
          fields: ["tenant_id", "created_at"],
        },
        {
          name: "idx_api_request_logs_module_created_at",
          fields: ["module", "created_at"],
        },
        {
          name: "idx_api_request_logs_success_created_at",
          fields: ["success", "created_at"],
        },
      ],
    },
  );
};
