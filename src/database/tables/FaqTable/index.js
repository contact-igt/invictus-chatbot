import { tableNames } from "../../tableName.js";

/**
 * FAQ Reviews Table
 *
 * Stores questions flagged by the AI (via MISSING_KNOWLEDGE tag) that
 * doctors can review, answer, and optionally publish into the Knowledge Base.
 *
 * Lifecycle:
 *   pending_review → published  (doctor approves + writes answer)
 *   pending_review → deleted    (doctor discards irrelevant question)
 *   published      → deleted    (doctor removes a published FAQ)
 *
 * One shared knowledge_source of type='faq' is reused per tenant for all
 * published FAQ entries (Doctor FAQ Knowledge). Never one source per row.
 */
export const FaqReviewsTable = (sequelize, Sequelize) => {
  return sequelize.define(
    tableNames.FAQ_REVIEWS,
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

      // Original raw question from the patient
      question: {
        type: Sequelize.TEXT,
        allowNull: false,
      },

      // AI-normalised/cleaned version for deduplication and search
      normalized_question: {
        type: Sequelize.TEXT,
        allowNull: true,
      },

      // Classification output from questionUnderstandingAgent
      agent_category: {
        type: Sequelize.ENUM(
          "valid_faq",
          "out_of_scope",
          "noise",
        ),
        allowNull: true,
      },

      // Human-readable reason from the classifier
      agent_reason: {
        type: Sequelize.TEXT,
        allowNull: true,
      },

      // Doctor's typed answer (set on publish)
      doctor_answer: {
        type: Sequelize.TEXT,
        allowNull: true,
      },

      // Source contact for context (whatsapp number that asked the question)
      whatsapp_number: {
        type: Sequelize.STRING,
        allowNull: true,
      },

      // Chat session reference for traceability
      session_id: {
        type: Sequelize.STRING,
        allowNull: true,
      },

      // WhatsApp Message ID from Meta API — unique identifier for the message that triggered FAQ
      wamid: {
        type: Sequelize.STRING,
        allowNull: true,
      },

      // Local database message ID — foreign key reference to messages table
      message_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },

      // Embedding vector (JSON array) — stored at FAQ creation time for semantic deduplication
      embedding: {
        type: Sequelize.TEXT("long"),
        allowNull: true,
      },

      // How many users have asked the same question (semantically) — drives priority sort
      ask_count: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 1,
      },

      // JSON array of alternate phrasings that were merged into this canonical question
      similar_questions: {
        type: Sequelize.TEXT("long"),
        allowNull: true,
      },

      // Soft match — FK to another faq_reviews.id when score is 0.65–0.78
      potential_duplicate_of: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },

      // Cosine similarity score when soft-linked to another FAQ
      match_similarity: {
        type: Sequelize.FLOAT,
        allowNull: true,
      },

      // Moderation lifecycle — status-only model (no extra is_deleted flag)
      status: {
        type: Sequelize.ENUM("pending_review", "published", "deleted"),
        allowNull: false,
        defaultValue: "pending_review",
      },

      // Whether the doctor approved this to go into the Knowledge Base
      add_to_kb: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },

      // Lets doctor disable a published FAQ from retrieval without deleting it
      is_active: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },

      // tenant_user who reviewed/published (nullable scalar in v1)
      reviewed_by: {
        type: Sequelize.STRING,
        allowNull: true,
      },

      // Timestamp when doctor_answer was saved and published
      answered_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },

      // Soft lifecycle — only set when status transitions to 'deleted'
      deleted_at: {
        type: Sequelize.DATE,
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
      tableName: tableNames.FAQ_REVIEWS,
      timestamps: true,
      underscored: true,
      indexes: [
        // Primary query index — list by tenant + status + newest first
        {
          name: "idx_faq_tenant_status_created",
          fields: ["tenant_id", "status", "created_at"],
        },
        // Dedupe guard — detect duplicate pending questions quickly
        {
          name: "idx_faq_tenant_normalised_status",
          fields: [
            "tenant_id",
            { name: "normalized_question", length: 191 },
            "status",
          ],
        },
        // Retrieval path — active published FAQ entries
        {
          name: "idx_faq_retrieval",
          fields: ["tenant_id", "status", "add_to_kb", "is_active"],
        },
        // Message tracking — find FAQ by original message (for Go to Chat feature)
        {
          name: "idx_faq_wamid",
          fields: ["wamid"],
        },
        // Local message reference — alternative lookup
        {
          name: "idx_faq_message_id",
          fields: ["message_id"],
        },
        {
          // Priority sort index — tier FAQs by ask_count per tenant
          name: "idx_faq_ask_count",
          fields: ["tenant_id", "ask_count"],
        },
      ],
    },
  );
};
