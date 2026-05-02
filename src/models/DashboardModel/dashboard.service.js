import db from "../../database/index.js";
import { tableNames } from "../../database/tableName.js";
import { Sequelize, Op } from "sequelize";

/**
 * Resolve startDateStr / endDateStr (YYYY-MM-DD) to concrete Date bounds,
 * a matching previous period for trend comparison, and a human-readable label.
 */
const resolveDateRange = (startDateStr, endDateStr) => {
  const parseLocal = (str) => {
    const [y, m, d] = str.split("-").map(Number);
    return new Date(y, m - 1, d);
  };

  const startDay = parseLocal(startDateStr);
  const endDay   = parseLocal(endDateStr);

  const periodStart = new Date(startDay);
  periodStart.setHours(0, 0, 0, 0);

  const periodEnd = new Date(endDay);
  periodEnd.setHours(23, 59, 59, 999);

  const durationMs      = periodEnd.getTime() - periodStart.getTime();
  const periodEndPrev   = new Date(periodStart.getTime() - 1);
  const periodStartPrev = new Date(periodEndPrev.getTime() - durationMs);

  const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const fmt = (d) => `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;

  // Use local date parts — NOT toISOString() which returns UTC and can shift the date
  // in timezones where local time differs from UTC (e.g. IST UTC+5:30).
  const localDateStr = (d) => {
    const n = d instanceof Date ? d : new Date();
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
  };
  const todayStr     = localDateStr(new Date());
  const yesterdayStr = (() => { const y = new Date(); y.setDate(y.getDate() - 1); return localDateStr(y); })();
  const isSingleDay = startDateStr === endDateStr;
  // Detect "All Time" preset — frontend uses 2000-01-01 as the sentinel start date
  const isAllTime   = startDateStr === "2000-01-01";

  let periodLabel;
  if      (isAllTime)                                    periodLabel = "All Time";
  else if (isSingleDay && startDateStr === todayStr)     periodLabel = "Today";
  else if (isSingleDay && startDateStr === yesterdayStr) periodLabel = "Yesterday";
  else if (isSingleDay)                                  periodLabel = fmt(startDay);
  else                                                   periodLabel = `${fmt(startDay)} - ${fmt(endDay)}`;

  return { periodStart, periodEnd, periodStartPrev, periodEndPrev, periodLabel, startDateStr, endDateStr, isAllTime };
};

/**
 * Get unified dashboard statistics for a specific tenant.
 *
 * Query strategy:
 *   Phase 1 — Always-run: WABA info, campaigns, billing, KPI counts, doctors.
 *   Phase 2 — Live-mode only (endDate >= today): active chats, hot leads, appointments, follow-ups.
 *
 * Response only contains fields the dashboard UI actually renders.
 */
export const getDashboardStatsService = async (tenantId, startDate, endDate) => {
  try {
    // Use local date — NOT toISOString() which returns UTC (causes wrong isLiveMode in non-UTC timezones)
    const todayNow   = new Date();
    const todayStr   = `${todayNow.getFullYear()}-${String(todayNow.getMonth() + 1).padStart(2, "0")}-${String(todayNow.getDate()).padStart(2, "0")}`;
    const resolvedStart = startDate || todayStr;
    const resolvedEnd   = endDate   || resolvedStart;

    const {
      periodStart, periodEnd,
      periodStartPrev, periodEndPrev,
      periodLabel, startDateStr, endDateStr, isAllTime,
    } = resolveDateRange(resolvedStart, resolvedEnd);

    // isLiveMode: endDate >= today — enables the "Live & Today" KPI cards row
    const isLiveMode = endDateStr >= todayStr;
    // shouldRunLiveSections: matches frontend shouldShowLiveData (Today | All Time)
    // Restricts heavy Phase-2b queries to only when the live sections are actually visible
    const shouldRunLiveSections = periodLabel === "Today" || isAllTime;

    // Real today bounds for "New Leads Today" live KPI
    const realTodayAtStart = new Date(); realTodayAtStart.setHours(0, 0, 0, 0);
    const realTodayAtEnd   = new Date(); realTodayAtEnd.setHours(23, 59, 59, 999);

    // Rolling-window bounds for WABA analytics (always real-time)
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const sevenDaysAgo       = new Date(Date.now() -  7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo      = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const pISO  = periodStart.toISOString();
    const pEISO = periodEnd.toISOString();

    // ─── PHASE 1: Always-run queries ──────────────────────────────────────────
    const [
      wabaInfo,
      [rolling24hRow],
      [sevenDayRow],
      [thirtyDayRow],
      newLeadsCount,
      totalLeadsPrevCount,
      allTimeLeadsCount,
      totalCampaignsCount,
      campaigns,
      [faqCountRow],
      [templateCountRow],
      billingKpiRows,
      msgUsageStatsRows,
      [knowledgeSourceRow],
      [contactRow],
      [groupRow],
      doctorStatusCounts,
      [specialCountRow],
      aiHandledChatsCount,
      agentHandledChatsCount,
    ] = await Promise.all([

      // WABA account info
      db.Whatsappaccount.findOne({
        where: { tenant_id: tenantId, is_deleted: false },
        attributes: ["whatsapp_number","status","is_verified","provider","quality","region","tier"],
        raw: true,
      }),

      // Rolling 24h WABA usage
      db.sequelize.query(
        `SELECT COUNT(DISTINCT contact_id) as used FROM messages
         WHERE tenant_id = :tenantId AND sender IN ('bot','admin') AND created_at >= :t`,
        { replacements: { tenantId, t: twentyFourHoursAgo.toISOString() }, type: db.sequelize.QueryTypes.SELECT },
      ),
      // Rolling 7-day unique users
      db.sequelize.query(
        `SELECT COUNT(DISTINCT contact_id) as unique_users FROM messages
         WHERE tenant_id = :tenantId AND sender IN ('bot','admin') AND created_at >= :t`,
        { replacements: { tenantId, t: sevenDaysAgo.toISOString() }, type: db.sequelize.QueryTypes.SELECT },
      ),
      // Rolling 30-day unique users
      db.sequelize.query(
        `SELECT COUNT(DISTINCT contact_id) as unique_users FROM messages
         WHERE tenant_id = :tenantId AND sender IN ('bot','admin') AND created_at >= :t`,
        { replacements: { tenantId, t: thirtyDaysAgo.toISOString() }, type: db.sequelize.QueryTypes.SELECT },
      ),

      // Leads in selected period (totalLeads KPI)
      db.Leads.count({
        where: { tenant_id: tenantId, is_deleted: false, created_at: { [Op.gte]: periodStart, [Op.lte]: periodEnd } },
      }),
      // Leads in previous period (for trend %)
      db.Leads.count({
        where: { tenant_id: tenantId, is_deleted: false, created_at: { [Op.gte]: periodStartPrev, [Op.lte]: periodEndPrev } },
      }),

      // All-time leads count (no date filter) — used for "Total Leads" card on Today / All Time presets
      db.Leads.count({
        where: { tenant_id: tenantId, is_deleted: false },
      }),

      // Campaigns count in period
      db.WhatsappCampaigns.count({
        where: { tenant_id: tenantId, is_deleted: false, created_at: { [Op.gte]: periodStart, [Op.lte]: periodEnd } },
      }),
      // Campaigns list (top 5, period-filtered)
      db.WhatsappCampaigns.findAll({
        where: { tenant_id: tenantId, is_deleted: false, created_at: { [Op.gte]: periodStart, [Op.lte]: periodEnd } },
        attributes: ["campaign_name","status","total_audience","delivered_count","read_count","replied_count"],
        order: [["created_at","DESC"]],
        limit: 5,
        raw: true,
      }),

      // FAQs in period
      db.sequelize.query(
        `SELECT COUNT(*) as total_faqs FROM ${tableNames.FAQ_REVIEWS}
         WHERE tenant_id = :tenantId AND status IN ('pending_review','published')
           AND created_at >= :pISO AND created_at <= :pEISO`,
        { replacements: { tenantId, pISO, pEISO }, type: db.sequelize.QueryTypes.SELECT },
      ),

      // Approved templates — all-time current state (intentionally no date filter)
      db.sequelize.query(
        `SELECT COUNT(*) as approved_templates FROM ${tableNames.WHATSAPP_TEMPLATE}
         WHERE tenant_id = :tenantId AND status = 'APPROVED' AND is_deleted = false`,
        { replacements: { tenantId }, type: db.sequelize.QueryTypes.SELECT },
      ),

      // Billing spend in period
      db.sequelize.query(
        `SELECT
           COALESCE(SUM(total_cost_inr), 0)                                                        AS total_spent,
           COALESCE(SUM(CASE WHEN category = 'marketing'      THEN total_cost_inr ELSE 0 END), 0) AS marketing_spent,
           COALESCE(SUM(CASE WHEN category = 'utility'        THEN total_cost_inr ELSE 0 END), 0) AS utility_spent,
           COALESCE(SUM(CASE WHEN category = 'authentication' THEN total_cost_inr ELSE 0 END), 0) AS auth_spent,
           COALESCE(SUM(CASE WHEN category = 'service'        THEN total_cost_inr ELSE 0 END), 0) AS service_spent
         FROM ${tableNames.BILLING_LEDGER}
         WHERE tenant_id = :tenantId AND created_at >= :pISO AND created_at <= :pEISO`,
        { replacements: { tenantId, pISO, pEISO }, type: db.sequelize.QueryTypes.SELECT },
      ),
      // Message usage in period
      db.sequelize.query(
        `SELECT COUNT(*) as total_messages,
                SUM(CASE WHEN billable = true  THEN 1 ELSE 0 END) as billable,
                SUM(CASE WHEN billable = false THEN 1 ELSE 0 END) as free_tier
         FROM ${tableNames.MESSAGE_USAGE}
         WHERE tenant_id = :tenantId AND timestamp >= :pISO AND timestamp <= :pEISO`,
        { replacements: { tenantId, pISO, pEISO }, type: db.sequelize.QueryTypes.SELECT },
      ),

      // Knowledge sources total (period-filtered, for KPI card)
      db.sequelize.query(
        `SELECT COUNT(*) as total_sources FROM ${tableNames.KNOWLEDGESOURCE}
         WHERE tenant_id = :tenantId AND is_deleted = false
           AND created_at >= :pISO AND created_at <= :pEISO`,
        { replacements: { tenantId, pISO, pEISO }, type: db.sequelize.QueryTypes.SELECT },
      ),

      // Contacts total (period-filtered, for KPI card)
      db.sequelize.query(
        `SELECT COUNT(*) as total_contacts FROM ${tableNames.CONTACTS}
         WHERE tenant_id = :tenantId AND is_deleted = false
           AND created_at >= :pISO AND created_at <= :pEISO`,
        { replacements: { tenantId, pISO, pEISO }, type: db.sequelize.QueryTypes.SELECT },
      ),

      // Contact groups total (period-filtered, for KPI card)
      db.sequelize.query(
        `SELECT COUNT(DISTINCT group_id) as total_groups FROM ${tableNames.CONTACT_GROUPS}
         WHERE tenant_id = :tenantId AND is_deleted = false
           AND created_at >= :pISO AND created_at <= :pEISO`,
        { replacements: { tenantId, pISO, pEISO }, type: db.sequelize.QueryTypes.SELECT },
      ),

      // Doctor status breakdown (always current — no date filter)
      db.sequelize.query(
        `SELECT status, COUNT(*) as count FROM ${tableNames.DOCTORS}
         WHERE tenant_id = :tenantId AND is_deleted = false GROUP BY status`,
        { replacements: { tenantId }, type: db.sequelize.QueryTypes.SELECT },
      ),
      // Specializations count (always current)
      db.sequelize.query(
        `SELECT COUNT(DISTINCT s.specialization_id) as count FROM ${tableNames.SPECIALIZATIONS} s
         WHERE s.tenant_id = :tenantId AND s.is_deleted = false AND s.is_active = true`,
        { replacements: { tenantId }, type: db.sequelize.QueryTypes.SELECT },
      ),

      // AI-handled (bot-resolved) closed chats in period — always run so AI% works for any date range
      db.LiveChat.count({
        where: { tenant_id: tenantId, status: "closed", updated_at: { [Op.gte]: periodStart, [Op.lte]: periodEnd }, assigned_admin_id: null },
      }),
      // Agent-handled closed chats in period — always run so AI% works for any date range
      db.LiveChat.count({
        where: { tenant_id: tenantId, status: "closed", updated_at: { [Op.gte]: periodStart, [Op.lte]: periodEnd }, assigned_admin_id: { [Op.ne]: null } },
      }),
    ]);

    // Attach rolling analytics to wabaInfo object
    if (wabaInfo) {
      wabaInfo.rolling24hUsed  = parseInt(rolling24hRow?.used        || 0, 10);
      wabaInfo.sevenDayUnique  = parseInt(sevenDayRow?.unique_users  || 0, 10);
      wabaInfo.thirtyDayUnique = parseInt(thirtyDayRow?.unique_users || 0, 10);
    }

    const billingKpi    = billingKpiRows[0]    || {};
    const msgUsageStats = msgUsageStatsRows[0] || {};

    // Compute AI auto-resolve % from Phase 1 data — period-filtered, works for ALL date ranges
    const totalHandledPhase1 = aiHandledChatsCount + agentHandledChatsCount;
    const aiHandledPct = totalHandledPhase1 > 0
      ? parseFloat(((aiHandledChatsCount / totalHandledPhase1) * 100).toFixed(1))
      : 0;

    // Debug: log resolved period and core metrics for each request
    console.log("[Dashboard] Period resolved:", {
      periodLabel, periodStart: pISO, periodEnd: pEISO, isLiveMode,
    });
    console.log("[Dashboard] Phase-1 metrics:", {
      totalLeads: newLeadsCount, totalCampaigns: totalCampaignsCount,
      billingTotal: parseFloat(billingKpi?.total_spent || 0),
      aiHandledPct, aiHandledChatsCount, agentHandledChatsCount,
    });

    // ─── PHASE 2: Live-mode queries (only when endDate >= today) ─────────────
    let liveData = null;
    if (isLiveMode) {
      const [
        actualTodayLeadsCount,
        activeChatsCount,
        [unassignedCount, escalatedCount],
        agentChatCounts,
        recentLeads,
        appointmentsTodayCount,
        followUpDueToday,
        followUpCompletedToday,
        followUpOverdue,
        upcomingAppointments,
      ] = await Promise.all([

        // New leads created TODAY (live KPI — always real today)
        db.Leads.count({
          where: { tenant_id: tenantId, is_deleted: false, created_at: { [Op.gte]: realTodayAtStart, [Op.lte]: realTodayAtEnd } },
        }),

        // Active chats right now (live queue total)
        db.LiveChat.count({ where: { tenant_id: tenantId, status: "active" } }),

        // Unassigned + escalated breakdown (live queue)
        Promise.all([
          db.LiveChat.count({ where: { tenant_id: tenantId, status: "active", assigned_admin_id: null } }),
          db.LiveChat.count({ where: { tenant_id: tenantId, status: "active", assigned_admin_id: { [Op.ne]: null } } }),
        ]),

        // Per-agent active chat count (for workload panel)
        db.LiveChat.findAll({
          where: { tenant_id: tenantId, status: "active", assigned_admin_id: { [Op.ne]: null } },
          attributes: ["assigned_admin_id", [Sequelize.fn("COUNT", Sequelize.col("id")), "chatCount"]],
          group: ["assigned_admin_id"],
          order: [[Sequelize.literal("chatCount"), "DESC"]],
          raw: true,
        }),

        // Hot/warm leads active in period (for live ops hot leads panel)
        db.Leads.findAll({
          where: {
            tenant_id: tenantId,
            is_deleted: false,
            heat_state: { [Op.in]: ["hot","warm"] },
            last_user_message_at: { [Op.gte]: periodStart, [Op.lte]: periodEnd },
          },
          include: [{ model: db.Contacts, as: "contact", attributes: ["name","phone"] }],
          order: [["last_user_message_at","DESC"]],
          limit: 5,
          raw: true,
          nest: true,
        }),

        // Appointments in period (for KPI card)
        db.Appointments.count({
          where: { tenant_id: tenantId, created_at: { [Op.gte]: periodStart, [Op.lte]: periodEnd } },
        }),

        // Follow-up: due (pending/confirmed) within period date range
        db.Appointments.count({
          where: { tenant_id: tenantId, appointment_date: { [Op.gte]: startDateStr, [Op.lte]: endDateStr }, status: { [Op.notIn]: ["Completed","Cancelled"] } },
        }),
        // Follow-up: completed within period date range
        db.Appointments.count({
          where: { tenant_id: tenantId, appointment_date: { [Op.gte]: startDateStr, [Op.lte]: endDateStr }, status: "Completed" },
        }),
        // Follow-up: overdue (before period start, still pending)
        db.Appointments.count({
          where: { tenant_id: tenantId, appointment_date: { [Op.lt]: startDateStr }, status: { [Op.notIn]: ["Completed","Cancelled"] } },
        }),
        // Upcoming appointments in period (top 5, ascending)
        db.Appointments.findAll({
          where: {
            tenant_id: tenantId,
            appointment_date: { [Op.gte]: startDateStr, [Op.lte]: endDateStr },
            status: { [Op.notIn]: ["Completed","Cancelled"] },
          },
          attributes: ["patient_name","appointment_time","status","contact_number"],
          order: [["appointment_time","ASC"]],
          limit: 5,
          raw: true,
        }),
      ]);

      // Phase 2b: Resolve agent names (depends on agentChatCounts from above)
      const agentIds = agentChatCounts.map((a) => a.assigned_admin_id).filter(Boolean);
      let agentDetails = [];
      if (agentIds.length > 0) {
        agentDetails = await db.TenantUsers.findAll({
          where: { tenant_user_id: { [Op.in]: agentIds }, is_deleted: false },
          attributes: ["tenant_user_id","username"],
          raw: true,
        });
      }

      const agentNameMap = {};
      agentDetails.forEach((a) => { agentNameMap[a.tenant_user_id] = a.username; });

      const agentWorkload = agentChatCounts.slice(0, 10).map((a) => ({
        agentId:   a.assigned_admin_id,
        name:      agentNameMap[a.assigned_admin_id] || "Unknown Agent",
        chatCount: parseInt(a.chatCount),
      }));

      liveData = {
        newLeadsToday:     actualTodayLeadsCount,
        activeChats:       activeChatsCount,
        unassignedCount,
        escalatedCount,
        agentWorkload,
        recentLeads,
        appointmentsToday: appointmentsTodayCount,
        dueToday:          followUpDueToday,
        completedToday:    followUpCompletedToday,
        overdue:           followUpOverdue,
        upcomingToday:     upcomingAppointments,
      };
    }

    // ─── Return lean payload — only fields the dashboard UI renders ───────────
    return {
      isLiveMode,
      periodLabel,
      waba: wabaInfo,

      kpis: {
        // Analytics KPIs (always sent — shown in all date ranges)
        totalLeads:        { current: newLeadsCount, previous: totalLeadsPrevCount, allTime: allTimeLeadsCount },
        aiAutoResolvedPct: aiHandledPct,   // Phase 1 — period-filtered, works for any date range
        totalCampaigns:    totalCampaignsCount,
        totalFaqs:         parseInt(faqCountRow?.total_faqs          || 0),
        approvedTemplates: parseInt(templateCountRow?.approved_templates || 0),
        totalSources:      parseInt(knowledgeSourceRow?.total_sources || 0),
        totalContacts:     parseInt(contactRow?.total_contacts        || 0),
        totalGroups:       parseInt(groupRow?.total_groups            || 0),
        // Live-only KPIs (null when isLiveMode=false; frontend hides "Live & Today" section)
        newLeadsToday:     liveData?.newLeadsToday     ?? null,
        activeChats:       liveData?.activeChats       ?? null,
        escalatedCount:    liveData?.escalatedCount    ?? null,
        appointmentsToday: liveData?.appointmentsToday ?? null,
      },

      campaigns,

      billingSummary: {
        totalSpent:    parseFloat(billingKpi?.total_spent     || 0),
        marketing:     parseFloat(billingKpi?.marketing_spent || 0),
        utility:       parseFloat(billingKpi?.utility_spent   || 0),
        auth:          parseFloat(billingKpi?.auth_spent      || 0),
        service:       parseFloat(billingKpi?.service_spent   || 0),
        totalMessages: parseInt(msgUsageStats?.total_messages || 0),
        billable:      parseInt(msgUsageStats?.billable       || 0),
        free:          parseInt(msgUsageStats?.free_tier      || 0),
      },

      doctorOverview: {
        statusCounts:        doctorStatusCounts,
        specializationCount: parseInt(specialCountRow?.count || 0),
      },

      // Live-mode sections — null when isLiveMode=false (frontend guards with shouldShowLiveData)
      liveOps: liveData ? {
        unassignedCount: liveData.unassignedCount,
        escalatedCount:  liveData.escalatedCount,
        agentWorkload:   liveData.agentWorkload,
        recentLeads:     liveData.recentLeads,
      } : null,

      followUps: liveData ? {
        dueToday:       liveData.dueToday,
        completedToday: liveData.completedToday,
        overdue:        liveData.overdue,
        upcomingToday:  liveData.upcomingToday,
      } : null,
    };

  } catch (err) {
    console.error("Dashboard Service Error:", err);
    throw err;
  }
};
