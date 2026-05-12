import { tableNames } from "../../tableName.js";

export const MentorsTable = (sequelize, Sequelize) => {
  return sequelize.define(
    tableNames.MENTORS,
    {
      id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
      },
      mentor_id: {
        type: Sequelize.STRING,
        allowNull: false,
        unique: true,
      },
      tenant_id: {
        type: Sequelize.STRING,
        allowNull: false,
        comment: "Link to tenants table",
      },
      name: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      expertise: {
        type: Sequelize.ENUM(
          "Technology",
          "Healthcare",
          "Marketing",
          "Design",
          "Business",
          "Finance",
          "Science"
        ),
        allowNull: false,
        defaultValue: "Technology",
      },
      rating: {
        type: Sequelize.DECIMAL(2, 1),
        allowNull: false,
        defaultValue: 4.0,
        validate: { min: 1, max: 5 },
      },
      color: {
        type: Sequelize.STRING,
        allowNull: false,
        defaultValue: "#059669",
        comment: "Hex color for mentor avatar",
      },
      is_deleted: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.NOW,
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.NOW,
      },
      deleted_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
    },
    {
      tableName: tableNames.MENTORS,
      timestamps: true,
      underscored: true,
      charset: "utf8mb4",
      collate: "utf8mb4_unicode_ci",
    }
  );
};
