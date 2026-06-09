import { tableNames } from "../../tableName.js";

export const BranchesTable = (sequelize, Sequelize) => {
  return sequelize.define(
    tableNames.BRANCHES,
    {
      id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
      },

      branch_id: {
        type: Sequelize.STRING,
        allowNull: false,
      },

      tenant_id: {
        type: Sequelize.STRING,
        allowNull: false,
      },

      name: {
        type: Sequelize.STRING,
        allowNull: false,
      },

      code: {
        type: Sequelize.STRING,
        allowNull: true,
      },

      address: {
        type: Sequelize.TEXT,
        allowNull: true,
      },

      city: {
        type: Sequelize.STRING,
        allowNull: true,
      },

      state: {
        type: Sequelize.STRING,
        allowNull: true,
      },

      country: {
        type: Sequelize.STRING,
        allowNull: true,
      },

      pincode: {
        type: Sequelize.STRING,
        allowNull: true,
      },

      phone: {
        type: Sequelize.STRING,
        allowNull: true,
      },

      email: {
        type: Sequelize.STRING,
        allowNull: true,
        validate: {
          isEmail: true,
        },
      },

      google_map_url: {
        type: Sequelize.TEXT,
        allowNull: true,
      },

      is_main: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },

      is_active: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
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

      created_by: {
        type: Sequelize.STRING,
        allowNull: true,
      },

      updated_by: {
        type: Sequelize.STRING,
        allowNull: true,
      },

      notes: {
        type: Sequelize.TEXT,
        allowNull: true,
      },

      timezone: {
        type: Sequelize.STRING,
        allowNull: true,
      },

      landmark: {
        type: Sequelize.STRING,
        allowNull: true,
      },

      latitude: {
        type: Sequelize.DECIMAL(10, 8),
        allowNull: true,
      },

      longitude: {
        type: Sequelize.DECIMAL(11, 8),
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
      tableName: tableNames.BRANCHES,
      timestamps: true,
      underscored: true,
      indexes: [
        {
          name: "unique_branch_id",
          unique: true,
          fields: ["branch_id"],
        },
        {
          name: "idx_branch_tenant_deleted",
          fields: ["tenant_id", "is_deleted"],
        },
        {
          name: "idx_branch_tenant_active_deleted",
          fields: ["tenant_id", "is_active", "is_deleted"],
        },
        {
          name: "idx_branch_tenant_main_deleted",
          fields: ["tenant_id", "is_main", "is_deleted"],
        },
        {
          name: "idx_branch_tenant_name",
          fields: ["tenant_id", "name"],
        },
        {
          name: "idx_branch_tenant_code",
          fields: ["tenant_id", "code"],
        },
      ],
    },
  );
};

