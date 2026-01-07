import { tableNames } from "../../tableName.js";

export const ChatStateTable = (sequelize, Sequelize) => {
  return sequelize.define(tableNames.CHATSTATE, {
    phone: {
      type: Sequelize.STRING,
      allowNull: true,
      unique: true,
    },

    name: {
      type: Sequelize.STRING,
      allowNull: true,
    },

    ai_enable: {
      type: Sequelize.STRING,
      allowNull: false,
      defaultValue: "true",
    },

    state: {
      type: Sequelize.ENUM("ai_active", "need_admin", "admin_active"),
      allowNull: false,
      defaultValue: "ai_active",
    },

    claimed_id: {
      type: Sequelize.STRING,
      allowNull: true,
    },

    summary_text: {
      type: Sequelize.TEXT,
      allowNull: true,
    },

    createdAt: {
      type: "TIMESTAMP",
      allowNull: true,
      defaultValue: sequelize.literal("CURRENT_TIMESTAMP"),
      field: "created_at",
    },

    updatedAt: {
      type: "TIMESTAMP",
      allowNull: true,
      defaultValue: sequelize.literal("CURRENT_TIMESTAMP"),
      field: "updated_at",
    },
  });
};


// chat_states
// -----------
// id
// phone              (UNIQUE)
// name
// ai_enable          (true / false)
// state              ai_active | need_admin | admin_active
// claimed_admin_id   (NULL or managements.id)
// summary_text
// created_at
// updated_at
