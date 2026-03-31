import db from "../../database/index.js";
import { tableNames } from "../../database/tableName.js";
import { Op, Sequelize } from "sequelize";
import { AiService } from "../../utils/ai/coreAi.js";

/**
 * Gets the start and end dates for the past N weeks
 * Week 1 = most recent week, Week 4 = oldest week
 */
const getWeekRanges = (numWeeks = 4) => {
  const weeks = [];
  const now = new Date();

  for (let i = 0; i < numWeeks; i++) {
    const endDate = new Date(now);
    endDate.setDate(endDate.getDate() - i * 7);
    endDate.setHours(23, 59, 59, 999);

    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - 6);
    startDate.setHours(0, 0, 0, 0);

    weeks.push({
      weekNumber: i + 1,
      startDate,
      endDate,
      startDateStr: startDate.toISOString().split("T")[0],
      endDateStr: endDate.toISOString().split("T")[0],
    });
  }

  return weeks;
};

/**
 * Calculate response rate for messages in a date range
 * Response rate = (messages with bot response / total user messages) * 100
 */
const calculateResponseRate = async (tenantId, startDate, endDate) => {
  try {
    // Count user messages (incoming)
    const [userMessagesResult] = await db.sequelize.query(
      `
      SELECT COUNT(*) as count
      FROM ${tableNames.MESSAGES}
      WHERE tenant_id = :tenantId
        AND sender = 'user'
        AND created_at BETWEEN :startDate AND :endDate
    `,
      {
        replacements: { tenantId, startDate, endDate },
        type: db.sequelize.QueryTypes.SELECT,
      },
    );

    // Count bot responses
    const [botResponsesResult] = await db.sequelize.query(
      `
      SELECT COUNT(*) as count
      FROM ${tableNames.MESSAGES}
      WHERE tenant_id = :tenantId
        AND sender = 'bot'
        AND created_at BETWEEN :startDate AND :endDate
    `,
      {
        replacements: { tenantId, startDate, endDate },
        type: db.sequelize.QueryTypes.SELECT,
      },
    );

    const userMessages = parseInt(userMessagesResult?.count || 0, 10);
    const botResponses = parseInt(botResponsesResult?.count || 0, 10);

    if (userMessages === 0) return 100; // No messages = 100% response rate
    return Math.min(100, Math.round((botResponses / userMessages) * 100));
  } catch (error) {
    console.error("Error calculating response rate:", error);
    return 0;
  }
};

/**
 * Get weekly summary statistics for the tenant dashboard
 * Returns 4 weeks of aggregated data
 */
export const getWeeklySummaryService = async (tenantId) => {
  try {
    const weeks = getWeekRanges(4);
    const summaries = [];

    for (const week of weeks) {
      // Get total messages (chats) for the week
      const [messagesResult] = await db.sequelize.query(
        `
        SELECT COUNT(*) as count
        FROM ${tableNames.MESSAGES}
        WHERE tenant_id = :tenantId
          AND created_at BETWEEN :startDate AND :endDate
      `,
        {
          replacements: {
            tenantId,
            startDate: week.startDate,
            endDate: week.endDate,
          },
          type: db.sequelize.QueryTypes.SELECT,
        },
      );

      // Get new leads for the week
      const [leadsResult] = await db.sequelize.query(
        `
        SELECT COUNT(*) as count
        FROM ${tableNames.LEADS}
        WHERE tenant_id = :tenantId
          AND is_deleted = false
          AND created_at BETWEEN :startDate AND :endDate
      `,
        {
          replacements: {
            tenantId,
            startDate: week.startDate,
            endDate: week.endDate,
          },
          type: db.sequelize.QueryTypes.SELECT,
        },
      );

      // Get unique contacts (conversations)
      const [conversationsResult] = await db.sequelize.query(
        `
        SELECT COUNT(DISTINCT contact_id) as count
        FROM ${tableNames.MESSAGES}
        WHERE tenant_id = :tenantId
          AND created_at BETWEEN :startDate AND :endDate
      `,
        {
          replacements: {
            tenantId,
            startDate: week.startDate,
            endDate: week.endDate,
          },
          type: db.sequelize.QueryTypes.SELECT,
        },
      );

      // Calculate response rate
      const responseRate = await calculateResponseRate(
        tenantId,
        week.startDate,
        week.endDate,
      );

      // Get appointments booked this week
      const [appointmentsResult] = await db.sequelize.query(
        `
        SELECT COUNT(*) as count
        FROM ${tableNames.APPOINTMENTS}
        WHERE tenant_id = :tenantId
          AND created_at BETWEEN :startDate AND :endDate
      `,
        {
          replacements: {
            tenantId,
            startDate: week.startDate,
            endDate: week.endDate,
          },
          type: db.sequelize.QueryTypes.SELECT,
        },
      );

      // Get resolved chats this week
      const [resolvedResult] = await db.sequelize.query(
        `
        SELECT COUNT(*) as count
        FROM ${tableNames.LIVECHAT}
        WHERE tenant_id = :tenantId
          AND status = 'closed'
          AND updated_at BETWEEN :startDate AND :endDate
      `,
        {
          replacements: {
            tenantId,
            startDate: week.startDate,
            endDate: week.endDate,
          },
          type: db.sequelize.QueryTypes.SELECT,
        },
      );

      const totalChats = parseInt(messagesResult?.count || 0, 10);
      const newLeads = parseInt(leadsResult?.count || 0, 10);
      const uniqueConversations = parseInt(conversationsResult?.count || 0, 10);
      const appointments = parseInt(appointmentsResult?.count || 0, 10);
      const resolvedChats = parseInt(resolvedResult?.count || 0, 10);

      // Generate AI summary based on metrics
      const summary = await generateWeeklySummary({
        weekNumber: week.weekNumber,
        totalChats,
        newLeads,
        responseRate,
        appointments,
        resolvedChats,
        uniqueConversations,
        startDate: week.startDateStr,
        endDate: week.endDateStr,
      });

      summaries.push({
        weekNumber: week.weekNumber,
        startDate: week.startDateStr,
        endDate: week.endDateStr,
        totalChats,
        newLeads,
        responseRate,
        appointments,
        resolvedChats,
        uniqueConversations,
        summary,
      });
    }

    return summaries;
  } catch (error) {
    console.error("Error getting weekly summary:", error);
    throw error;
  }
};

/**
 * Generate an AI-powered weekly summary from metrics
 */
const generateWeeklySummary = async (metrics) => {
  const {
    weekNumber,
    totalChats,
    newLeads,
    responseRate,
    appointments,
    resolvedChats,
    uniqueConversations,
    startDate,
    endDate,
  } = metrics;

  // Fast fallback if zero activity
  if (totalChats === 0 && newLeads === 0 && appointments === 0) {
    return "No significant activity recorded this week.";
  }

  const prompt = `You are a business analytics assistant. Generate a concise 2-3 sentence weekly performance summary for a WhatsApp-based business dashboard.

Week: ${startDate} to ${endDate}
Metrics:
- Total messages: ${totalChats}
- Unique conversations: ${uniqueConversations}
- New leads captured: ${newLeads}
- AI response rate: ${responseRate}%
- Appointments booked: ${appointments}
- Resolved chats: ${resolvedChats}

Rules:
- Write 2-3 sentences max. Be specific with numbers.
- Highlight what went well and what needs attention.
- Compare implicitly (e.g. "strong" or "below average") based on the numbers.
- No bullet points. No greetings. Just the summary paragraph.
- Do not repeat the date range.

Summary:`;

  try {
    const aiSummary = await AiService("system", prompt, null, "weekly_summary");
    return aiSummary?.trim() || buildFallbackSummary(metrics);
  } catch (err) {
    console.error(
      "[WEEKLY-SUMMARY] AI generation failed, using fallback:",
      err.message,
    );
    return buildFallbackSummary(metrics);
  }
};

/**
 * Fallback summary if AI fails
 */
const buildFallbackSummary = (metrics) => {
  const { totalChats, newLeads, responseRate, appointments } = metrics;
  const parts = [];
  if (totalChats > 50)
    parts.push(`High engagement with ${totalChats} messages.`);
  else if (totalChats > 0) parts.push(`${totalChats} messages exchanged.`);
  if (newLeads > 0)
    parts.push(`${newLeads} new lead${newLeads > 1 ? "s" : ""} captured.`);
  if (responseRate > 0) parts.push(`AI response rate: ${responseRate}%.`);
  if (appointments > 0)
    parts.push(
      `${appointments} appointment${appointments > 1 ? "s" : ""} booked.`,
    );
  return parts.join(" ") || "No significant activity to report.";
};

/**
 * Get per-contact weekly analytics for the modal view
 * Shows 4 weeks of conversation history with a specific contact
 */
export const getContactWeeklySummaryService = async (
  tenantId,
  contactId,
  contactPhone,
) => {
  try {
    const weeks = getWeekRanges(4);
    const summaries = [];

    // Get contact info
    const [contactInfo] = await db.sequelize.query(
      `
      SELECT contact_id, name, phone, email
      FROM ${tableNames.CONTACTS}
      WHERE (contact_id = :contactId OR phone = :contactPhone)
        AND tenant_id = :tenantId
      LIMIT 1
    `,
      {
        replacements: { tenantId, contactId: contactId || "", contactPhone },
        type: db.sequelize.QueryTypes.SELECT,
      },
    );

    const actualContactId = contactInfo?.contact_id || contactId;

    for (const week of weeks) {
      // Get messages for this contact this week
      const [messagesResult] = await db.sequelize.query(
        `
        SELECT 
          COUNT(*) as total_count,
          SUM(CASE WHEN sender = 'user' THEN 1 ELSE 0 END) as user_count,
          SUM(CASE WHEN sender = 'bot' THEN 1 ELSE 0 END) as bot_count,
          SUM(CASE WHEN sender = 'admin' THEN 1 ELSE 0 END) as admin_count
        FROM ${tableNames.MESSAGES}
        WHERE tenant_id = :tenantId
          AND (contact_id = :contactId OR phone = :contactPhone OR phone = :contactPhone)
          AND created_at BETWEEN :startDate AND :endDate
      `,
        {
          replacements: {
            tenantId,
            contactId: actualContactId || "",
            contactPhone,
            startDate: week.startDate,
            endDate: week.endDate,
          },
          type: db.sequelize.QueryTypes.SELECT,
        },
      );

      // Get message content for topics and sentiment analysis
      const messageTexts = await db.sequelize.query(
        `
        SELECT message, sender, created_at
        FROM ${tableNames.MESSAGES}
        WHERE tenant_id = :tenantId
          AND (contact_id = :contactId OR phone = :contactPhone)
          AND created_at BETWEEN :startDate AND :endDate
          AND message IS NOT NULL
        ORDER BY created_at ASC
        LIMIT 50
      `,
        {
          replacements: {
            tenantId,
            contactId: actualContactId || "",
            contactPhone,
            startDate: week.startDate,
            endDate: week.endDate,
          },
          type: db.sequelize.QueryTypes.SELECT,
        },
      );

      const messageCount = parseInt(messagesResult?.total_count || 0, 10);
      const userMessages = parseInt(messagesResult?.user_count || 0, 10);
      const botMessages = parseInt(messagesResult?.bot_count || 0, 10);

      // Extract key topics from messages (simple keyword extraction)
      const keyTopics = extractKeyTopics(messageTexts || []);

      // Analyze sentiment based on message patterns
      const sentiment = analyzeSentiment(messageTexts || []);

      // Calculate average response time (estimated)
      const avgResponseTime = calculateAvgResponseTime(messageTexts || []);

      // Extract action items from messages
      const actionItems = extractActionItems(messageTexts || []);

      // Calculate engagement score
      const engagementScore = calculateEngagementScore({
        messageCount,
        userMessages,
        botMessages,
        actionItems: actionItems.length,
      });

      // Calculate change from previous week
      const prevWeekIndex = summaries.length > 0 ? summaries.length - 1 : -1;
      const prevWeekTotal =
        prevWeekIndex >= 0
          ? summaries[prevWeekIndex].messageCount
          : messageCount;
      const changeFromPrevious =
        prevWeekTotal > 0
          ? Math.round(((messageCount - prevWeekTotal) / prevWeekTotal) * 100)
          : 0;

      // Generate AI-powered contact-specific summary
      const summary = await generateContactSummary({
        contactName: contactInfo?.name || "Contact",
        messageCount,
        sentiment,
        keyTopics,
        actionItems,
        userMessages,
        botMessages,
        startDate: week.startDateStr,
        endDate: week.endDateStr,
      });

      summaries.push({
        weekNumber: week.weekNumber,
        startDate: week.startDateStr,
        endDate: week.endDateStr,
        summary,
        messageCount,
        sentiment,
        avgResponseTime,
        keyTopics,
        actionItems,
        engagementScore,
        changeFromPrevious,
      });
    }

    return {
      contact: contactInfo || { phone: contactPhone },
      totalMessages: summaries.reduce((sum, w) => sum + w.messageCount, 0),
      avgEngagement: Math.round(
        summaries.reduce((sum, w) => sum + w.engagementScore, 0) /
          summaries.length,
      ),
      totalWeeks: summaries.filter((w) => w.messageCount > 0).length,
      totalActionItems: summaries.reduce(
        (sum, w) => sum + w.actionItems.length,
        0,
      ),
      weeks: summaries,
    };
  } catch (error) {
    console.error("Error getting contact weekly summary:", error);
    throw error;
  }
};

/**
 * Extract key topics from messages using keyword matching
 */
const extractKeyTopics = (messages) => {
  const topicKeywords = {
    Pricing: ["price", "cost", "pricing", "rate", "fee", "charge", "payment"],
    Appointment: [
      "appointment",
      "schedule",
      "book",
      "booking",
      "meeting",
      "slot",
    ],
    Support: ["help", "support", "issue", "problem", "error", "fix"],
    Features: ["feature", "option", "capability", "function", "how to"],
    Demo: ["demo", "demonstration", "trial", "test", "preview"],
    Integration: ["integrate", "integration", "connect", "api", "sync"],
    Availability: ["available", "availability", "timing", "hours", "open"],
    "Product Info": ["product", "service", "offer", "detail", "information"],
  };

  const foundTopics = new Set();
  const allText = messages
    .map((m) => (m.message || "").toLowerCase())
    .join(" ");

  for (const [topic, keywords] of Object.entries(topicKeywords)) {
    if (keywords.some((kw) => allText.includes(kw))) {
      foundTopics.add(topic);
    }
  }

  return Array.from(foundTopics).slice(0, 4);
};

/**
 * Analyze sentiment from messages
 */
const analyzeSentiment = (messages) => {
  const positiveWords = [
    "thank",
    "thanks",
    "great",
    "good",
    "excellent",
    "helpful",
    "appreciate",
    "perfect",
    "awesome",
    "happy",
    "yes",
    "sure",
    "interested",
  ];
  const negativeWords = [
    "no",
    "not",
    "bad",
    "issue",
    "problem",
    "wrong",
    "error",
    "unhappy",
    "frustrated",
    "complaint",
    "cancel",
    "refund",
  ];

  let positiveCount = 0;
  let negativeCount = 0;

  messages.forEach((m) => {
    const text = (m.message || "").toLowerCase();
    positiveWords.forEach((w) => {
      if (text.includes(w)) positiveCount++;
    });
    negativeWords.forEach((w) => {
      if (text.includes(w)) negativeCount++;
    });
  });

  if (positiveCount > negativeCount + 2) return "positive";
  if (negativeCount > positiveCount + 2) return "negative";
  return "neutral";
};

/**
 * Calculate average response time from message timestamps
 */
const calculateAvgResponseTime = (messages) => {
  if (messages.length < 2) return "N/A";

  let totalResponseTime = 0;
  let responseCount = 0;

  for (let i = 1; i < messages.length; i++) {
    const prev = messages[i - 1];
    const curr = messages[i];

    // If previous was user and current is bot/admin, calculate response time
    if (
      prev.sender === "user" &&
      (curr.sender === "bot" || curr.sender === "admin")
    ) {
      const timeDiff = new Date(curr.created_at) - new Date(prev.created_at);
      const minutes = timeDiff / (1000 * 60);
      if (minutes > 0 && minutes < 60) {
        // Ignore if > 1 hour
        totalResponseTime += minutes;
        responseCount++;
      }
    }
  }

  if (responseCount === 0) return "N/A";
  const avgMinutes = totalResponseTime / responseCount;

  if (avgMinutes < 1) return `${Math.round(avgMinutes * 60)} sec`;
  return `${avgMinutes.toFixed(1)} min`;
};

/**
 * Extract action items from messages
 */
const extractActionItems = (messages) => {
  const actionPatterns = [
    /send (me|us|a) (.*?)(?:\.|$)/gi,
    /schedule (a|the) (.*?)(?:\.|$)/gi,
    /follow up (on|about) (.*?)(?:\.|$)/gi,
    /need (to|a) (.*?)(?:\.|$)/gi,
    /request (for|a) (.*?)(?:\.|$)/gi,
    /call (me|back|regarding) (.*?)(?:\.|$)/gi,
  ];

  const actionItems = [];
  const allText = messages.map((m) => m.message || "").join(". ");

  actionPatterns.forEach((pattern) => {
    const matches = allText.match(pattern);
    if (matches) {
      matches.slice(0, 2).forEach((m) => {
        const cleanItem = m
          .replace(/^(send|schedule|follow up|need|request|call)\s+/i, "")
          .trim();
        if (cleanItem.length > 3 && cleanItem.length < 50) {
          actionItems.push(
            cleanItem.charAt(0).toUpperCase() + cleanItem.slice(1),
          );
        }
      });
    }
  });

  return [...new Set(actionItems)].slice(0, 3);
};

/**
 * Calculate engagement score (0-100)
 */
const calculateEngagementScore = ({
  messageCount,
  userMessages,
  botMessages,
  actionItems,
}) => {
  let score = 50; // Base score

  // Message volume contribution (0-25 points)
  score += Math.min(25, messageCount * 2);

  // User engagement (messages from user) (0-15 points)
  score += Math.min(15, userMessages * 3);

  // Action items indicate interest (0-10 points)
  score += Math.min(10, actionItems * 5);

  return Math.min(100, Math.max(0, score));
};

/**
 * Generate AI-powered contact-specific summary narrative
 */
const generateContactSummary = async ({
  contactName,
  messageCount,
  sentiment,
  keyTopics,
  actionItems,
  userMessages,
  botMessages,
  startDate,
  endDate,
}) => {
  if (messageCount === 0) {
    return "No conversation activity during this period.";
  }

  const prompt = `You are a CRM analytics assistant. Write a 2-3 sentence summary of a customer's weekly WhatsApp interaction.

Customer: ${contactName}
Period: ${startDate} to ${endDate}
- Total messages: ${messageCount} (Customer: ${userMessages}, Bot/Admin: ${botMessages})
- Sentiment: ${sentiment}
- Topics discussed: ${keyTopics.length > 0 ? keyTopics.join(", ") : "General inquiry"}
- Action items: ${actionItems.length > 0 ? actionItems.join("; ") : "None"}

Rules:
- 2-3 sentences. Be specific.
- Mention the customer by name.
- Highlight sentiment and key topics naturally.
- If there are action items, mention them.
- No bullet points. No greetings. Just the summary.

Summary:`;

  try {
    const aiSummary = await AiService(
      "system",
      prompt,
      null,
      "contact_weekly_summary",
    );
    return (
      aiSummary?.trim() ||
      buildFallbackContactSummary({
        contactName,
        messageCount,
        sentiment,
        keyTopics,
        actionItems,
      })
    );
  } catch (err) {
    console.error(
      "[CONTACT-SUMMARY] AI generation failed, using fallback:",
      err.message,
    );
    return buildFallbackContactSummary({
      contactName,
      messageCount,
      sentiment,
      keyTopics,
      actionItems,
    });
  }
};

/**
 * Fallback contact summary if AI fails
 */
const buildFallbackContactSummary = ({
  contactName,
  messageCount,
  sentiment,
  keyTopics,
  actionItems,
}) => {
  const parts = [];
  if (messageCount > 10)
    parts.push(
      `${contactName} showed high engagement with ${messageCount} messages.`,
    );
  else if (messageCount > 5)
    parts.push(
      `Regular interaction with ${contactName} (${messageCount} messages).`,
    );
  else parts.push(`Brief exchange with ${contactName}.`);
  if (keyTopics.length > 0) parts.push(`Topics: ${keyTopics.join(", ")}.`);
  if (sentiment === "negative")
    parts.push("Some concerns raised that may need attention.");
  if (actionItems.length > 0)
    parts.push(
      `${actionItems.length} action item${actionItems.length > 1 ? "s" : ""} identified.`,
    );
  return parts.join(" ");
};
