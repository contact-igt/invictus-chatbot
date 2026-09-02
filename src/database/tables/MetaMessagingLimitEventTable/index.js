import { tableNames } from "../../tableName.js";

export const MetaMessagingLimitEventTable = (sequelize, Sequelize) =>
  sequelize.define(
    tableNames.META_MESSAGING_LIMIT_EVENTS,
    {
      id: {
        type: Sequelize.BIGINT,
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
      },
      // BUG-3: no column-level `unique: true`. Sequelize `sync({ alter: true })`
      // cannot recognise unnamed unique indexes and re-creates them every boot
      // (reservation_id_2, _3, wamid_2, _3 …). The unique constraints live in the
      // named `indexes` block below — one canonical index each, forever.
      reservation_id: {
        type: Sequelize.STRING(36),
        allowNull: false,
      },
      tenant_id: { type: Sequelize.STRING, allowNull: false },
      waba_id: { type: Sequelize.STRING, allowNull: false },
      phone_number_id: { type: Sequelize.STRING, allowNull: false },
      recipient_phone: { type: Sequelize.STRING(32), allowNull: false },
      template_name: { type: Sequelize.STRING, allowNull: true },
      wamid: { type: Sequelize.STRING, allowNull: true },
      status: {
        type: Sequelize.ENUM("reserved", "sent", "delivered", "read", "failed"),
        allowNull: false,
        defaultValue: "reserved",
      },
      qualifies: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      sent_at: { type: Sequelize.DATE, allowNull: false },
      delivered_at: { type: Sequelize.DATE, allowNull: true },
    },
    {
      tableName: tableNames.META_MESSAGING_LIMIT_EVENTS,
      timestamps: true,
      underscored: true,
      indexes: [
        { name: "uq_meta_limit_reservation", unique: true, fields: ["reservation_id"] },
        { name: "uq_meta_limit_wamid", unique: true, fields: ["wamid"] },
        { name: "idx_meta_limit_waba_sent", fields: ["waba_id", "qualifies", "sent_at"] },
        { name: "idx_meta_limit_waba_delivered", fields: ["waba_id", "qualifies", "delivered_at"] },
        { name: "idx_meta_limit_recipient", fields: ["waba_id", "recipient_phone", "sent_at"] },
      ],
    },
  );

