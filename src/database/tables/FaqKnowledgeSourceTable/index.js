import { tableNames } from "../../tableName.js";

/**
 * FAQ Knowledge Source Table
 *
 * Stores published FAQ entries that are actively served by the AI retrieval
 * pipeline. Each row is a child record under the tenant's Doctor FAQ Knowledge
 * master source (knowledge_sources type='faq').
 *
 * Storage Model:
 *   faq_payload: JSON object containing { question: string, answer: string }
 *
 * Lifecycle:
 *   populate → on publishFaqService (upsert by faq_review_id to avoid duplicates)
 *   update   → on editFaqKnowledgeEntryService (same row, updated_at + updated_by)
 *   remove   → soft remove via is_active = false, or hard delete admin action
 *
 * AI retrieval reads from faq_payload.question and faq_payload.answer using
 * JSON_EXTRACT for keyword matching and prompt context assembly.
 */
export const FaqKnowledgeSourceTable = (sequelize, Sequelize) => {
  return sequelize.define(
    tableNames.FAQ_KNOWLEDGE_SOURCE,
    {
      id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
      },

      tenant_id: {
        type: Sequelize.STRING,
        allowNull: false,
      },

      // FK → knowledge_sources.id (Doctor FAQ Knowledge master source)
      source_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
      },

      // FK → faq_reviews.id (the moderation record this entry came from)
      faq_review_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
      },

      // Unified Q+A storage: { question: string, answer: string }
      // All business read/write logic uses this field exclusively.
      faq_payload: {
        type: Sequelize.JSON,
        allowNull: true,
      },

      // false = removed from AI retrieval (soft remove)
      is_active: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },

      // Tenant user ID of the last person who edited this entry
      updated_by: {
        type: Sequelize.STRING,
        allowNull: true,
      },

      updated_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },

      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.NOW,
      },
    },
    {
      tableName: tableNames.FAQ_KNOWLEDGE_SOURCE,
      timestamps: false,
    },
  );
};
