import { tableNames } from "../../tableName.js";

export const CoursesTable = (sequelize, Sequelize) => {
  return sequelize.define(
    tableNames.COURSES,
    {
      id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
      },
      course_id: {
        type: Sequelize.STRING,
        allowNull: false,
        unique: true,
      },
      tenant_id: {
        type: Sequelize.STRING,
        allowNull: false,
        comment: "Link to tenants table",
      },
      title: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      category: {
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
      level: {
        type: Sequelize.ENUM("Beginner", "Intermediate", "Advanced"),
        allowNull: false,
        defaultValue: "Beginner",
      },
      mentor_id: {
        type: Sequelize.STRING,
        allowNull: true,
        comment: "Link to mentors table",
      },
      lessons: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      duration: {
        type: Sequelize.STRING,
        allowNull: false,
        defaultValue: "0h",
        comment: "e.g., 4h 30m",
      },
      price: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0.0,
      },
      description: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      registration_link: {
        type: Sequelize.STRING(1024),
        allowNull: true,
        comment: "Optional registration URL for the course",
      },
      meeting_link: {
        type: Sequelize.STRING(1024),
        allowNull: true,
        comment: "Optional meeting/join URL for the course",
      },
      status: {
        type: Sequelize.ENUM("Active", "Draft", "Archived"),
        allowNull: false,
        defaultValue: "Draft",
      },
      enrolled: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      completion: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
        comment: "Completion percentage (0-100)",
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
      tableName: tableNames.COURSES,
      timestamps: true,
      underscored: true,
      charset: "utf8mb4",
      collate: "utf8mb4_unicode_ci",
    }
  );
};
