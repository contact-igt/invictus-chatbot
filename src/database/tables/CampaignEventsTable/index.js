import { tableNames } from "../../tableName.js";

export const CampaignEventsTable = (sequelize, Sequelize) => {
  return sequelize.define(
    tableNames.CAMPAIGN_EVENTS,
    {
      id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
      },
      campaign_id: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      recipient_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
      },
      event_type: {
        type: Sequelize.ENUM("open", "click"),
        allowNull: false,
      },
      occurred_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: sequelize.literal("CURRENT_TIMESTAMP"),
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
      tableName: tableNames.CAMPAIGN_EVENTS,
      timestamps: true,
      underscored: true,
      indexes: [
        { name: "idx_campaign_events_campaign", fields: ["campaign_id"] },
        { name: "idx_campaign_events_recipient", fields: ["recipient_id"] },
        { name: "idx_campaign_events_type", fields: ["event_type"] },
      ],
    },
  );
};
