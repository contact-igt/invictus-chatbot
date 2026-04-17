import db from "../../database/index.js";
import { tableNames } from "../../database/tableName.js";
import { Sequelize, Op } from "sequelize";

/**
 * Resolve a period string ("7days" | "30days" | "alltime") to a concrete Date range.
 * Returns { periodStart, periodStartPrev, periodLabel }
 */
const resolvePeriod = (period) => {
  const now = new Date();
  now.setHours(23, 59, 59, 999);

  if (period === "7days") {
    const start = new Date();
    start.setDate(start.getDate() - 7);
    start.setHours(0, 0, 0, 0);
    const prev = new Date();
    prev.setDate(prev.getDate() - 14);
    prev.setHours(0, 0, 0, 0);
    return { periodStart: start, periodStartPrev: prev, periodLabel: "7 Days" };
  }
  if (period === "alltime") {
    return {
      periodStart: null,
      periodStartPrev: null,
      periodLabel: "All Time",
    };
  }
  // Default: 30days
  const start = new Date();
  start.setDate(start.getDate() - 30);
  start.setHours(0, 0, 0, 0);
  const prev = new Date();
  prev.setDate(prev.getDate() - 60);
  prev.setHours(0, 0, 0, 0);
  return { periodStart: start, periodStartPrev: prev, periodLabel: "30 Days" };
};

/**
 * Get unified dashboard statistics for a specific tenant.
 * Optimized with targeted queries for heavy data tables.
 */
export const getDashboardStatsService = async (tenantId, period = "30days") => {
  try {
    const todayAtStart = new Date();
    todayAtStart.setHours(0, 0, 0, 0);

    const yesterdayAtStart = new Date(todayAtStart);
    yesterdayAtStart.setDate(yesterdayAtStart.getDate() - 1);

    // Resolve period for time-scoped queries (funnel, trends)
    const { periodStart, periodStartPrev, periodLabel } = resolvePeriod(period);
    // Build Sequelize where clause fragment for period-filtered queries
    const periodWhere = periodStart ? { [Op.gte]: periodStart } : {};

    // === 1. WABA Info ===
    const wabaInfo = await db.Whatsappaccount.findOne({
      where: { tenant_id: tenantId, is_deleted: false },
      attributes: [
        "whatsapp_number",
        "status",
        "is_verified",
        "provider",
        "quality",
        "region",
        "tier",
      ],
      raw: true,
    });

    // === 1.b. WABA limit rolling analytics ===
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [usedConversations24hRow] = await db.sequelize.query(
      `
            SELECT COUNT(DISTINCT contact_id) as used
            FROM messages
            WHERE tenant_id = :tenantId
              AND sender IN ('bot', 'admin')
              AND created_at >= :targetTime
        `,
      {
        replacements: {
          tenantId,
          targetTime: twentyFourHoursAgo.toISOString(),
        },
        type: db.sequelize.QueryTypes.SELECT,
      },
    );

    const [sevenDayUniqueRow] = await db.sequelize.query(
      `
            SELECT COUNT(DISTINCT contact_id) as unique_users
            FROM messages
            WHERE tenant_id = :tenantId
              AND sender IN ('bot', 'admin')
              AND created_at >= :targetTime
        `,
      {
        replacements: { tenantId, targetTime: sevenDaysAgo.toISOString() },
        type: db.sequelize.QueryTypes.SELECT,
      },
    );

    const [thirtyDayUniqueRow] = await db.sequelize.query(
      `
            SELECT COUNT(DISTINCT contact_id) as unique_users
            FROM messages
            WHERE tenant_id = :tenantId
              AND sender IN ('bot', 'admin')
              AND created_at >= :targetTime
        `,
      {
        replacements: { tenantId, targetTime: thirtyDaysAgo.toISOString() },
        type: db.sequelize.QueryTypes.SELECT,
      },
    );

    if (wabaInfo) {
      wabaInfo.rolling24hUsed = parseInt(
        usedConversations24hRow?.used || 0,
        10,
      );
      wabaInfo.sevenDayUnique = parseInt(
        sevenDayUniqueRow?.unique_users || 0,
        10,
      );
      wabaInfo.thirtyDayUnique = parseInt(
        thirtyDayUniqueRow?.unique_users || 0,
        10,
      );
    }

    // === 2. Header Metrics (in parallel) ===
    const [newLeadsToday, resolvedToday, messagesSentToday] = await Promise.all(
      [
        db.Leads.count({
          where: {
            tenant_id: tenantId,
            created_at: { [Op.gte]: todayAtStart },
            is_deleted: false,
          },
        }),
        db.LiveChat.count({
          where: {
            tenant_id: tenantId,
            status: "closed",
            updated_at: { [Op.gte]: todayAtStart },
          },
        }),
        db.Messages.count({
          where: {
            tenant_id: tenantId,
            sender: { [Op.in]: ["bot", "admin"] },
            created_at: { [Op.gte]: todayAtStart },
          },
        }),
      ],
    );

    // === 3. KPI — Total Leads with Trend (compared to previous equivalent period) ===
    const leadsTotalWhere = {
      tenant_id: tenantId,
      is_deleted: false,
      ...(periodStart ? { created_at: { [Op.gte]: periodStart } } : {}),
    };
    const leadsPrevWhere = periodStartPrev
      ? {
          tenant_id: tenantId,
          is_deleted: false,
          created_at: { [Op.gte]: periodStartPrev, [Op.lt]: periodStart },
        }
      : {
          tenant_id: tenantId,
          is_deleted: false,
          created_at: { [Op.lt]: todayAtStart },
        };

    const [totalLeadsNow, totalLeadsYesterday] = await Promise.all([
      db.Leads.count({ where: leadsTotalWhere }),
      db.Leads.count({ where: leadsPrevWhere }),
    ]);

    // === 4. Active Chats ===
    const activeChats = await db.LiveChat.count({
      where: { tenant_id: tenantId, status: "active" },
    });

    // === 5. Live Operations — Unassigned & Escalated counts ===
    const [unassignedCount, escalatedCount] = await Promise.all([
      // Unassigned: active chats with no agent assigned
      db.LiveChat.count({
        where: {
          tenant_id: tenantId,
          status: "active",
          assigned_admin_id: null,
        },
      }),
      // Escalated: active chats that have been assigned to a human agent
      db.LiveChat.count({
        where: {
          tenant_id: tenantId,
          status: "active",
          assigned_admin_id: { [Op.ne]: null },
        },
      }),
    ]);

    // === 6. Agent Workload — LiveChat count per agent ===
    const agentChatCounts = await db.LiveChat.findAll({
      where: {
        tenant_id: tenantId,
        status: "active",
        assigned_admin_id: { [Op.ne]: null },
      },
      attributes: [
        "assigned_admin_id",
        [Sequelize.fn("COUNT", Sequelize.col("id")), "chatCount"],
      ],
      group: ["assigned_admin_id"],
      order: [[Sequelize.literal("chatCount"), "DESC"]],
      limit: 10,
      raw: true,
    });

    // Lookup agent names from TenantUsers
    const agentIds = agentChatCounts
      .map((a) => a.assigned_admin_id)
      .filter(Boolean);
    let agentDetails = [];
    if (agentIds.length > 0) {
      agentDetails = await db.TenantUsers.findAll({
        where: { tenant_user_id: { [Op.in]: agentIds }, is_deleted: false },
        attributes: ["tenant_user_id", "username"],
        raw: true,
      });
    }
    const agentMap = {};
    agentDetails.forEach((a) => {
      agentMap[a.tenant_user_id] = a.username;
    });

    const agentWorkload = agentChatCounts.map((a) => ({
      agentId: a.assigned_admin_id,
      name: agentMap[a.assigned_admin_id] || "Unknown Agent",
      chatCount: parseInt(a.chatCount),
    }));

    // === 9. Campaigns (latest 5, PERIOD-FILTERED) ===
    const campaigns = await db.WhatsappCampaigns.findAll({
      where: {
        tenant_id: tenantId,
        is_deleted: false,
        ...(periodStart ? { created_at: { [Op.gte]: periodStart } } : {}),
      },
      attributes: [
        "campaign_name",
        "status",
        "total_audience",
        "delivered_count",
        "read_count",
        "replied_count",
      ],
      order: [["created_at", "DESC"]],
      limit: 5,
      raw: true,
    });

    // === 12. Appointments Today ===
    const appointmentsToday = await db.Appointments.count({
      where: {
        tenant_id: tenantId,
        created_at: { [Op.gte]: todayAtStart },
      },
    });

    // === 13. Recent Activity Feed (Latest Hot Leads) ===
    const recentLeads = await db.Leads.findAll({
      where: {
        tenant_id: tenantId,
        is_deleted: false,
        heat_state: { [Op.in]: ["hot", "warm"] },
      },
      include: [
        { model: db.Contacts, as: "contact", attributes: ["name", "phone"] },
      ],
      order: [["last_user_message_at", "DESC"]],
      limit: 5,
      raw: true,
      nest: true,
    });

    // ═══════════════════════════════════════════════════════════════════
    // === 14. AGENT PERFORMANCE ===
    // Per-agent: chat count, avg response time (bot reply wait), status
    // ═══════════════════════════════════════════════════════════════════

    // All active agents for this tenant
    const allAgents = await db.TenantUsers.findAll({
      where: {
        tenant_id: tenantId,
        is_deleted: false,
        role: { [Op.in]: ["agent", "staff", "doctor"] },
      },
      attributes: ["tenant_user_id", "username", "status", "role"],
      raw: true,
    });

    // Active chats per agent
    const agentChatCountsPerf = await db.LiveChat.findAll({
      where: {
        tenant_id: tenantId,
        status: "active",
        assigned_admin_id: { [Op.ne]: null },
      },
      attributes: [
        "assigned_admin_id",
        [Sequelize.fn("COUNT", Sequelize.col("id")), "chatCount"],
      ],
      group: ["assigned_admin_id"],
      raw: true,
    });
    const agentChatMap = {};
    agentChatCountsPerf.forEach((a) => {
      agentChatMap[a.assigned_admin_id] = parseInt(a.chatCount);
    });

    // Avg response time per agent — avg seconds between last user msg and next admin msg
    // Use Messages: for each contact where sender_id = agent, find time gap
    const agentResponseTimes = await db.sequelize.query(
      `
            SELECT
                m.sender_id AS agent_id,
                AVG(TIMESTAMPDIFF(SECOND, prev_msg.created_at, m.created_at)) AS avg_response_sec
            FROM messages m
            JOIN (
                SELECT contact_id, MAX(created_at) AS created_at
                FROM messages
                WHERE tenant_id = :tenantId AND sender = 'user'
                GROUP BY contact_id
            ) prev_msg ON m.contact_id = prev_msg.contact_id
            WHERE m.tenant_id = :tenantId
              AND m.sender = 'admin'
              AND m.created_at > prev_msg.created_at
              AND m.created_at >= :weekStart
            GROUP BY m.sender_id
        `,
      {
        replacements: {
          tenantId,
          weekStart: new Date(
            Date.now() - 7 * 24 * 60 * 60 * 1000,
          ).toISOString(),
        },
        type: db.sequelize.QueryTypes.SELECT,
      },
    );
    const agentResponseMap = {};
    agentResponseTimes.forEach((r) => {
      agentResponseMap[r.agent_id] = Math.round(
        parseFloat(r.avg_response_sec) || 0,
      );
    });

    // Total active agents (have at least 1 active chat)
    const activeAgentCount = Object.keys(agentChatMap).length;
    const totalAgentCount = allAgents.length;

    // Peak hour — the hour with most messages sent today by admin/bot
    const [peakHourResult] = await db.sequelize.query(
      `
            SELECT HOUR(created_at) AS hour, COUNT(*) AS cnt
            FROM messages
            WHERE tenant_id = :tenantId
              AND sender IN ('admin', 'bot')
              AND created_at >= :todayStart
            GROUP BY HOUR(created_at)
            ORDER BY cnt DESC
            LIMIT 1
        `,
      {
        replacements: { tenantId, todayStart: todayAtStart.toISOString() },
        type: db.sequelize.QueryTypes.SELECT,
      },
    );

    const peakHour = peakHourResult
      ? (() => {
          const h = parseInt(peakHourResult.hour);
          const ampm = h >= 12 ? "PM" : "AM";
          const hour12 = h % 12 === 0 ? 12 : h % 12;
          return `${String(hour12).padStart(2, "0")}:00 ${ampm}`;
        })()
      : null;

    // Build agent performance array
    const agentPerformance = allAgents
      .map((agent) => ({
        agentId: agent.tenant_user_id,
        name: agent.username,
        role: agent.role,
        onlineStatus: agent.status === "active" ? "online" : "offline",
        chatCount: agentChatMap[agent.tenant_user_id] || 0,
        avgResponseSec: agentResponseMap[agent.tenant_user_id] || 0,
      }))
      .sort((a, b) => b.chatCount - a.chatCount);

    // ═══════════════════════════════════════════════════════════════════
    // === 15. FOLLOW-UP INTELLIGENCE (from Appointments table) ===
    // ═══════════════════════════════════════════════════════════════════
    const todayDateStr = todayAtStart.toISOString().split("T")[0]; // "2026-03-11"

    const [
      followUpDueToday,
      followUpCompletedToday,
      followUpOverdue,
      upcomingAppointments,
    ] = await Promise.all([
      // DUE TODAY: appointment_date = today, not yet completed/cancelled
      db.Appointments.count({
        where: {
          tenant_id: tenantId,
          appointment_date: todayDateStr,
          status: { [Op.notIn]: ["Completed", "Cancelled"] },
        },
      }),
      // COMPLETED TODAY
      db.Appointments.count({
        where: {
          tenant_id: tenantId,
          appointment_date: todayDateStr,
          status: "Completed",
        },
      }),
      // OVERDUE: appointment_date < today & not completed/cancelled
      db.Appointments.count({
        where: {
          tenant_id: tenantId,
          appointment_date: { [Op.lt]: todayDateStr },
          status: { [Op.notIn]: ["Completed", "Cancelled"] },
        },
      }),
      // UPCOMING TODAY: sorted by appointment_time
      db.Appointments.findAll({
        where: {
          tenant_id: tenantId,
          appointment_date: todayDateStr,
          status: { [Op.notIn]: ["Completed", "Cancelled"] },
        },
        attributes: [
          "patient_name",
          "appointment_time",
          "status",
          "contact_number",
        ],
        order: [["appointment_time", "ASC"]],
        limit: 5,
        raw: true,
      }),
    ]);

    // AI vs Agent handled — closed chats (PERIOD-FILTERED)
    const closedChatWhere = {
      tenant_id: tenantId,
      status: "closed",
      ...(periodStart ? { updated_at: { [Op.gte]: periodStart } } : {}),
    };
    const [aiHandledChats, agentHandledChats] = await Promise.all([
      db.LiveChat.count({
        where: { ...closedChatWhere, assigned_admin_id: null },
      }),
      db.LiveChat.count({
        where: { ...closedChatWhere, assigned_admin_id: { [Op.ne]: null } },
      }),
    ]);
    const totalHandledChats = aiHandledChats + agentHandledChats;
    const aiHandledPct =
      totalHandledChats > 0
        ? parseFloat(((aiHandledChats / totalHandledChats) * 100).toFixed(1))
        : 0;
    const agentHandledPct =
      totalHandledChats > 0
        ? parseFloat(((agentHandledChats / totalHandledChats) * 100).toFixed(1))
        : 0;

    // Nurture efficiency = AI auto-resolved % (reuse aiHandledPct)
    const nurtureEfficiency = aiHandledPct;

    // ═══════════════════════════════════════════════════════════════════
    // === 16. MESSAGING ANALYTICS (PERIOD-FILTERED) ===
    // ═══════════════════════════════════════════════════════════════════
    // Use period for aggregate counts; chart always shows last 7 days
    const msgDateFilter = periodStart
      ? { created_at: { [Op.gte]: periodStart } }
      : {};

    // Previous period for trend comparison
    const msgPrevFilter = periodStartPrev
      ? { created_at: { [Op.gte]: periodStartPrev, [Op.lt]: periodStart } }
      : {};

    // Chart uses the same date window as the selected period
    let chartStart = new Date(todayAtStart);
    if (period === '7days') {
      chartStart.setDate(chartStart.getDate() - 6);
    } else if (period === '30days') {
      chartStart.setDate(chartStart.getDate() - 29);
    } else {
      chartStart = new Date('2020-01-01'); // Safe past date for 'all time'
    }

    const [
      totalMsgsInPeriod,
      totalMsgsPrevPeriod,
      failedMsgsInPeriod,
      deliveredMsgsInPeriod,
      dailyVolumeRaw,
    ] = await Promise.all([
      // Total messages in period
      db.Messages.count({
        where: { tenant_id: tenantId, ...msgDateFilter },
      }),
      // Previous period total for trend
      periodStartPrev
        ? db.Messages.count({
            where: { tenant_id: tenantId, ...msgPrevFilter },
          })
        : Promise.resolve(0),
      // Failed outgoing in period
      db.Messages.count({
        where: {
          tenant_id: tenantId,
          ...msgDateFilter,
          sender: { [Op.in]: ["bot", "admin"] },
          status: "failed",
        },
      }),
      // Delivered outgoing in period
      db.Messages.count({
        where: {
          tenant_id: tenantId,
          ...msgDateFilter,
          sender: { [Op.in]: ["bot", "admin"] },
          status: { [Op.in]: ["delivered", "read"] },
        },
      }),
      // Daily volume chart — uses the selected period window
      db.sequelize.query(
        `
                SELECT
                    DATE(created_at) AS day,
                    COUNT(*) AS total,
                    SUM(CASE WHEN sender = 'bot' THEN 1 ELSE 0 END) AS ai_handled
                FROM messages
                WHERE tenant_id = :tenantId
                  AND created_at >= :chartStart
                GROUP BY DATE(created_at)
                ORDER BY day ASC
            `,
        {
          replacements: { tenantId, chartStart: chartStart.toISOString() },
          type: db.sequelize.QueryTypes.SELECT,
        },
      ),
    ]);

    const dailyVolumeMap = {};
    dailyVolumeRaw.forEach((r) => {
      dailyVolumeMap[r.day] = r;
    });

    let dailyVolume = [];

    if (period === '7days') {
      // 7 Days: Show Daily (Mon, Tue...)
      const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
      dailyVolume = Array.from({ length: 7 }, (_, i) => {
        const d = new Date(chartStart);
        d.setDate(d.getDate() + i);
        const dateStr = d.toISOString().split("T")[0];
        const dayLabel = days[d.getDay() === 0 ? 6 : d.getDay() - 1];
        const row = dailyVolumeMap[dateStr] || {};
        return {
          day: dayLabel,
          date: dateStr,
          total: parseInt(row.total || 0),
          aiHandled: parseInt(row.ai_handled || 0),
        };
      });
    } else if (period === '30days') {
      // 30 Days: Show Weekly (Week 1, Week 2...)
      // Group the 30 days into 4-5 weeks, ending on today.
      const weeks = [];
      let currentWeekData = { total: 0, aiHandled: 0 };
      
      for (let i = 0; i < 30; i++) {
        const d = new Date(chartStart);
        d.setDate(d.getDate() + i);
        const dateStr = d.toISOString().split("T")[0];
        const row = dailyVolumeMap[dateStr] || {};
        
        currentWeekData.total += parseInt(row.total || 0);
        currentWeekData.aiHandled += parseInt(row.ai_handled || 0);
        
        // Push every 7 days or on the final day
        if ((i + 1) % 7 === 0 || i === 29) {
          const weekNumber = Math.ceil((i + 1) / 7);
          weeks.push({
            day: `Week ${weekNumber}`,
            date: dateStr,
            total: currentWeekData.total,
            aiHandled: currentWeekData.aiHandled,
          });
          currentWeekData = { total: 0, aiHandled: 0 }; // Reset for next week
        }
      }
      dailyVolume = weeks;
    } else {
      // All Time: Dynamically group by Year or Month based on org creation date
      let groupBy = 'month';
      const todayDate = new Date();
      
      const tenantRow = await db.sequelize.query(
        `SELECT created_at FROM tenants WHERE tenant_id = :tenantId`,
        { replacements: { tenantId }, type: db.sequelize.QueryTypes.SELECT }
      );

      let oldestDate = tenantRow && tenantRow.length > 0 && tenantRow[0].created_at 
        ? new Date(tenantRow[0].created_at) 
        : new Date();

      const daysDiff = (todayDate - oldestDate) / (1000 * 60 * 60 * 24);
      if (daysDiff > 365) {
        groupBy = 'year';
        // Ensure at least 3 years of data to draw a healthy line chart (prevents 1 or 2 dot charts)
        if (daysDiff < 1095) {
            oldestDate = new Date();
            oldestDate.setFullYear(oldestDate.getFullYear() - 2);
        }
      } else {
        // Ensure at least 6 months of data to draw a healthy line chart (prevents a 1-dot chart for brand new orgs)
        if (daysDiff < 150) {
            oldestDate = new Date();
            oldestDate.setMonth(oldestDate.getMonth() - 5);
        }
      }

      const groupedMap = {};
      const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

      // 1. Pre-fill the groupedMap with 0s for every period from oldestDate to today
      let iterDate = new Date(oldestDate);
      iterDate.setDate(1); 
      if (groupBy === 'year') {
        iterDate.setMonth(0);
      }

      while (iterDate <= todayDate) {
        let label;
        let sortKey;
        if (groupBy === 'year') {
          label = iterDate.getFullYear().toString();
          sortKey = label;
        } else {
          label = monthNames[iterDate.getMonth()] + " " + iterDate.getFullYear().toString().slice(-2); // "Mar 24"
          sortKey = iterDate.getFullYear() + "-" + String(iterDate.getMonth() + 1).padStart(2, '0');
        }
        
        if (!groupedMap[sortKey]) {
            groupedMap[sortKey] = { day: label, date: sortKey, total: 0, aiHandled: 0 };
        }

        if (groupBy === 'year') {
          iterDate.setFullYear(iterDate.getFullYear() + 1);
        } else {
          iterDate.setMonth(iterDate.getMonth() + 1);
        }
      }

      // 2. Populate actual data into the map
      dailyVolumeRaw.forEach((r) => {
        const date = new Date(r.day);
        let sortKey;
        if (groupBy === 'year') {
          sortKey = date.getFullYear().toString();
        } else {
          sortKey = date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, '0');
        }

        if (groupedMap[sortKey]) {
          groupedMap[sortKey].total += parseInt(r.total || 0);
          groupedMap[sortKey].aiHandled += parseInt(r.ai_handled || 0);
        }
      });
      
      dailyVolume = Object.keys(groupedMap)
        .sort((a, b) => a.localeCompare(b))
        .map(k => groupedMap[k]);
    }

    // Outgoing messages in period for rate calculations
    const outgoingInPeriod = deliveredMsgsInPeriod + failedMsgsInPeriod;
    const deliveryRate =
      outgoingInPeriod > 0
        ? parseFloat(
            ((deliveredMsgsInPeriod / outgoingInPeriod) * 100).toFixed(1),
          )
        : 100;
    const failedRate =
      outgoingInPeriod > 0
        ? parseFloat(((failedMsgsInPeriod / outgoingInPeriod) * 100).toFixed(1))
        : 0;

    // Trend vs previous period
    const msgsTrend =
      totalMsgsPrevPeriod > 0
        ? parseFloat(
            (
              ((totalMsgsInPeriod - totalMsgsPrevPeriod) /
                totalMsgsPrevPeriod) *
              100
            ).toFixed(1),
          )
        : 0;

    // Avg per day & per hour
    let periodDays = period === "7days" ? 7 : period === "30days" ? 30 : 90;
    if (period === "alltime") {
        const tr = await db.sequelize.query(
            `SELECT created_at FROM tenants WHERE tenant_id = :tenantId`,
            { replacements: { tenantId }, type: db.sequelize.QueryTypes.SELECT }
        );
        const orgCreatedAt = tr && tr.length > 0 && tr[0].created_at ? new Date(tr[0].created_at) : new Date();
        const daysDiff = Math.ceil((new Date() - orgCreatedAt) / (1000 * 60 * 60 * 24));
        periodDays = daysDiff > 0 ? daysDiff : 1;
    }
    const avgPerDay = Math.round(totalMsgsInPeriod / periodDays);
    const msgsPerHour = Math.round(totalMsgsInPeriod / (periodDays * 24));

    // Response rate: messages from bot/admin / total user messages in period
    const userMsgsInPeriod = await db.Messages.count({
      where: { tenant_id: tenantId, ...msgDateFilter, sender: "user" },
    });
    const botAdminMsgs = totalMsgsInPeriod - userMsgsInPeriod;
    const responseRate =
      userMsgsInPeriod > 0
        ? parseFloat(((botAdminMsgs / userMsgsInPeriod) * 100).toFixed(1))
        : 100;

    // ═══════════════════════════════════════════════════════════════════
    // NEW SECTIONS — Doctors, Knowledge, Contacts
    // ═══════════════════════════════════════════════════════════════════

    // §N4 — Doctor overview
    const doctorStatusCounts = await db.sequelize.query(
      `
            SELECT status, COUNT(*) as count
            FROM ${tableNames.DOCTORS}
            WHERE tenant_id = :tenantId AND is_deleted = false
            GROUP BY status
        `,
      { replacements: { tenantId }, type: db.sequelize.QueryTypes.SELECT },
    );

    const [specialCount] = await db.sequelize.query(
      `
            SELECT COUNT(DISTINCT s.specialization_id) as count
            FROM ${tableNames.SPECIALIZATIONS} s
            WHERE s.tenant_id = :tenantId AND s.is_deleted = false AND s.is_active = true
        `,
      { replacements: { tenantId }, type: db.sequelize.QueryTypes.SELECT },
    );

    // §N5 — Knowledge Base health
    const [knowledgeStats] = await db.sequelize.query(
      `
            SELECT
                COUNT(*) as total_sources,
                SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active_sources,
                SUM(CASE WHEN status = 'inactive' THEN 1 ELSE 0 END) as inactive_sources
            FROM ${tableNames.KNOWLEDGESOURCE}
            WHERE tenant_id = :tenantId AND is_deleted = false
        `,
      { replacements: { tenantId }, type: db.sequelize.QueryTypes.SELECT },
    );

    const [chunkStats] = await db.sequelize.query(
      `
            SELECT COUNT(*) as total_chunks
            FROM ${tableNames.KNOWLEDGECHUNKS}
            WHERE tenant_id = :tenantId AND is_deleted = false
        `,
      { replacements: { tenantId }, type: db.sequelize.QueryTypes.SELECT },
    );

    const knowledgeSourceTypes = await db.sequelize.query(
      `
            SELECT type, COUNT(*) as count
            FROM ${tableNames.KNOWLEDGESOURCE}
            WHERE tenant_id = :tenantId AND is_deleted = false
            GROUP BY type
        `,
      { replacements: { tenantId }, type: db.sequelize.QueryTypes.SELECT },
    );

    // §N6 — Contact & Audience overview
    const [contactStats] = await db.sequelize.query(
      `
            SELECT
                COUNT(*) as total_contacts,
                SUM(CASE WHEN is_blocked = true THEN 1 ELSE 0 END) as blocked,
                SUM(CASE WHEN is_ai_silenced = true THEN 1 ELSE 0 END) as ai_silenced
            FROM ${tableNames.CONTACTS}
            WHERE tenant_id = :tenantId AND is_deleted = false
        `,
      { replacements: { tenantId }, type: db.sequelize.QueryTypes.SELECT },
    );

    const [groupStats] = await db.sequelize.query(
      `
            SELECT
                COUNT(DISTINCT g.group_id) as total_groups,
                COUNT(gm.id) as total_members
            FROM ${tableNames.CONTACT_GROUPS} g
            LEFT JOIN ${tableNames.CONTACT_GROUP_MEMBERS} gm ON gm.group_id = g.group_id AND gm.tenant_id = g.tenant_id
            WHERE g.tenant_id = :tenantId AND g.is_deleted = false
        `,
      { replacements: { tenantId }, type: db.sequelize.QueryTypes.SELECT },
    );

    // §N7 — Billing summary (inline query — no separate API call)
    const billingKpiRows = await db.sequelize.query(
      `
            SELECT
                COALESCE(SUM(total_cost_inr), 0) as total_spent,
                COALESCE(SUM(CASE WHEN category = 'marketing' THEN total_cost_inr ELSE 0 END), 0) as marketing_spent,
                COALESCE(SUM(CASE WHEN category = 'utility' THEN total_cost_inr ELSE 0 END), 0) as utility_spent,
                COALESCE(SUM(CASE WHEN category = 'authentication' THEN total_cost_inr ELSE 0 END), 0) as auth_spent,
                COALESCE(SUM(CASE WHEN category = 'service' THEN total_cost_inr ELSE 0 END), 0) as service_spent
            FROM ${tableNames.BILLING_LEDGER}
            WHERE tenant_id = :tenantId
            ${periodStart ? "AND created_at >= :periodStart" : ""}
        `,
      {
        replacements: { tenantId, periodStart: periodStart },
        type: db.sequelize.QueryTypes.SELECT,
      },
    );
    const billingKpi = billingKpiRows[0] || {};

    const msgUsageStatsRows = await db.sequelize.query(
      `
            SELECT
                COUNT(*) as total_messages,
                SUM(CASE WHEN billable = true THEN 1 ELSE 0 END) as billable,
                SUM(CASE WHEN billable = false THEN 1 ELSE 0 END) as free_tier
            FROM ${tableNames.MESSAGE_USAGE}
            WHERE tenant_id = :tenantId
            ${periodStart ? "AND timestamp >= :periodStart" : ""}
        `,
      {
        replacements: { tenantId, periodStart: periodStart },
        type: db.sequelize.QueryTypes.SELECT,
      },
    );
    const msgUsageStats = msgUsageStatsRows[0] || {};

    const revenueTodayRows = await db.sequelize.query(
      `
            SELECT COALESCE(SUM(total_cost_inr), 0) as revenue
            FROM ${tableNames.BILLING_LEDGER}
            WHERE tenant_id = :tenantId
              AND created_at >= :targetTime
        `,
      {
        replacements: { tenantId, targetTime: todayAtStart },
        type: db.sequelize.QueryTypes.SELECT,
      },
    );
    const revenueTodayRow = revenueTodayRows[0] || {};

    // ═══════════════════════════════════════════════════════════════════
    // RETURN ALL DATA
    // ═══════════════════════════════════════════════════════════════════
    return {
      waba: wabaInfo,
      periodLabel,
      header: {
        revenueToday: parseFloat(revenueTodayRow?.revenue || 0).toFixed(2),
        newLeadsToday,
        resolvedToday,
        messagesSentToday,
        needsAttention: unassignedCount,
      },
      kpis: {
        totalLeads: { current: totalLeadsNow, previous: totalLeadsYesterday },
        activeChats,
        appointmentsToday,
        aiAutoResolvedPct: aiHandledPct,
      },
      liveOps: {
        unassignedCount,
        escalatedCount,
        agentWorkload,
      },
      campaigns,
      recent: {
        leads: recentLeads,
        logs: [],
      },
      // NEW SECTIONS
      agentPerf: {
        agents: agentPerformance,
        activeCount: activeAgentCount,
        totalCount: totalAgentCount,
        peakTime: peakHour,
      },
      followUps: {
        dueToday: followUpDueToday,
        completedToday: followUpCompletedToday,
        overdue: followUpOverdue,
        aiHandledPct,
        agentHandledPct,
        upcomingToday: upcomingAppointments,
        nurtureEfficiency,
      },
      messagingAnalytics: {
        totalThisWeek: totalMsgsInPeriod,
        trendVsPrevWeek: msgsTrend,
        avgPerDay,
        msgsPerHour,
        responseRate,
        deliveryRate,
        failedRate,
        dailyVolume, // array of 7 items: { day, date, total, aiHandled }
      },
      // NEW SECTIONS
      doctorOverview: {
        statusCounts: doctorStatusCounts,
        specializationCount: parseInt(specialCount?.count || 0),
      },
      knowledgeHealth: {
        totalSources: parseInt(knowledgeStats?.total_sources || 0),
        activeSources: parseInt(knowledgeStats?.active_sources || 0),
        inactiveSources: parseInt(knowledgeStats?.inactive_sources || 0),
        totalChunks: parseInt(chunkStats?.total_chunks || 0),
        sourceTypes: knowledgeSourceTypes,
      },
      contactOverview: {
        totalContacts: parseInt(contactStats?.total_contacts || 0),
        blocked: parseInt(contactStats?.blocked || 0),
        aiSilenced: parseInt(contactStats?.ai_silenced || 0),
        totalGroups: parseInt(groupStats?.total_groups || 0),
        avgGroupSize:
          parseInt(groupStats?.total_groups || 0) > 0
            ? Math.round(
                parseInt(groupStats?.total_members || 0) /
                  parseInt(groupStats?.total_groups || 0),
              )
            : 0,
      },
      billingSummary: {
        totalSpent: parseFloat(billingKpi?.total_spent || 0),
        marketingSpent: parseFloat(billingKpi?.marketing_spent || 0),
        utilitySpent: parseFloat(billingKpi?.utility_spent || 0),
        authSpent: parseFloat(billingKpi?.auth_spent || 0),
        serviceSpent: parseFloat(billingKpi?.service_spent || 0),
        totalMessagesSent: parseInt(msgUsageStats?.total_messages || 0),
        billableConversations: parseInt(msgUsageStats?.billable || 0),
        freeConversations: parseInt(msgUsageStats?.free_tier || 0),
      },
    };
  } catch (err) {
    console.error("Dashboard Service Error:", err);
    throw err;
  }
};
