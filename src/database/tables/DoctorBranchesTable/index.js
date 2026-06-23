import { tableNames } from "../../tableName.js";

export const DoctorBranchesTable = (sequelize, Sequelize) => {
  return sequelize.define(
    tableNames.DOCTOR_BRANCHES,
    {
      id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
      },

      doctor_id: {
        type: Sequelize.STRING,
        allowNull: false,
      },

      branch_id: {
        type: Sequelize.STRING,
        allowNull: false,
      },

      tenant_id: {
        type: Sequelize.STRING,
        allowNull: false,
      },

      is_primary: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },

      is_active: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
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
      tableName: tableNames.DOCTOR_BRANCHES,
      timestamps: true,
      underscored: true,
      indexes: [
        {
          name: "unique_doctor_branch_tenant",
          unique: true,
          fields: ["tenant_id", "doctor_id", "branch_id"],
        },
        {
          name: "idx_doctor_branches_doctor",
          fields: ["tenant_id", "doctor_id"],
        },
        {
          name: "idx_doctor_branches_branch",
          fields: ["tenant_id", "branch_id"],
        },
        {
          name: "idx_doctor_branches_primary",
          fields: ["tenant_id", "doctor_id", "is_primary"],
        },
      ],
    },
  );
};
