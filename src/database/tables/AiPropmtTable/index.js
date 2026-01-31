import { tableNames } from "../../tableName.js";

export const AiPromptTable = (sequelize, Sequelize) => {
  return sequelize.define(
    tableNames.AIPROMPT,
    {
      tenant_id: {
        type: Sequelize.STRING,
        allowNull: false,
      },

      name: {
        type: Sequelize.STRING,
        allowNull: true,
      },

      prompt: {
        type: Sequelize.TEXT,
        allowNull: false,
      },

      is_active: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
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
      tableName: tableNames.AIPROMPT,
      timestamps: true,
      underscored: true,
      indexes: [
        {
          fields: ["tenant_id"],
        },
        {
          fields: ["tenant_id", "is_active"],
        },
      ],
    }
  );
};
