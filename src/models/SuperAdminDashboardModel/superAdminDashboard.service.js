import db from "../../database/index.js";
import { Op, Sequelize } from "sequelize";

/**
 * Resolve a period string to a concrete Date range.
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
  const start = new Date();
  start.setDate(start.getDate() - 30);
  start.setHours(0, 0, 0, 0);
  const prev = new Date();
  prev.setDate(prev.getDate() - 60);
  prev.setHours(0, 0, 0, 0);
  return { periodStart: start, periodStartPrev: prev, periodLabel: "30 Days" };
};

/**
 * Get super admin dashboard statistics — platform-wide metrics.
 */
export const getSuperAdminDashboardStatsService = async (period = "30days") => {
  const todayAtStart = new Date();
  todayAtStart.setHours(0, 0, 0, 0);

  const { periodStart, periodStartPrev, periodLabel } = resolvePeriod(period);
  const periodWhere = periodStart
    ? { created_at: { [Op.gte]: periodStart } }
    : {};
  const prevPeriodWhere =
    periodStartPrev && periodStart
      ? { created_at: { [Op.gte]: periodStartPrev, [Op.lt]: periodStart } }
      : {};

  // ─── 1. Tenant Overview ──────────────────────────────────────────
  const [
    totalTenants,
    activeTenants,
    inactiveTenants,
    deletedTenants,
    newTenantsInPeriod,
    newTenantsInPrevPeriod,
  ] = await Promise.all([
    db.Tenants.count({ where: { is_deleted: false } }),
    db.Tenants.count({ where: { status: "active", is_deleted: false } }),
    db.Tenants.count({ where: { status: "inactive", is_deleted: false } }),
    db.Tenants.count({ where: { is_deleted: true } }),
    db.Tenants.count({ where: { is_deleted: false, ...periodWhere } }),
    periodStartPrev
      ? db.Tenants.count({ where: { is_deleted: false, ...prevPeriodWhere } })
      : Promise.resolve(0),
  ]);

  // ─── 2. Management Users ─────────────────────────────────────────
  const [totalAdmins, activePlatformAdmins, superAdminCount] =
    await Promise.all([
      db.Management.count({ where: { is_deleted: false } }),
      db.Management.count({
        where: { role: "platform_admin", status: "active", is_deleted: false },
      }),
      db.Management.count({
        where: { role: "super_admin", is_deleted: false },
      }),
    ]);

  // ─── 3. Tenant Users (Across all tenants) ───────────────────────
  const [totalTenantUsers, tenantUsersByRole] = await Promise.all([
    db.TenantUsers.count({ where: { is_deleted: false } }),
    db.TenantUsers.findAll({
      where: { is_deleted: false },
      attributes: [
        "role",
        [Sequelize.fn("COUNT", Sequelize.col("id")), "count"],
      ],
      group: ["role"],
      raw: true,
    }),
  ]);

  // ─── 4. Platform-Wide Message Stats ──────────────────────────────
  const [totalMessagesInPeriod, totalMessagesInPrevPeriod, messagesToday] =
    await Promise.all([
      db.Messages.count({ where: { ...periodWhere } }),
      periodStartPrev
        ? db.Messages.count({ where: { ...prevPeriodWhere } })
        : Promise.resolve(0),
      db.Messages.count({ where: { created_at: { [Op.gte]: todayAtStart } } }),
    ]);

  // ─── 5. Platform-Wide Lead Stats ─────────────────────────────────
  const [totalLeads, leadsInPeriod, leadsInPrevPeriod, leadsToday] =
    await Promise.all([
      db.Leads.count({ where: { is_deleted: false } }),
      db.Leads.count({ where: { is_deleted: false, ...periodWhere } }),
      periodStartPrev
        ? db.Leads.count({ where: { is_deleted: false, ...prevPeriodWhere } })
        : Promise.resolve(0),
      db.Leads.count({
        where: { is_deleted: false, created_at: { [Op.gte]: todayAtStart } },
      }),
    ]);

  // ─── 6. Campaign Stats ───────────────────────────────────────────
  const [totalCampaigns, campaignsByStatus] = await Promise.all([
    db.WhatsappCampaigns.count({ where: { ...periodWhere } }),
    db.WhatsappCampaigns.findAll({
      where: { ...periodWhere },
      attributes: [
        "status",
        [Sequelize.fn("COUNT", Sequelize.col("id")), "count"],
      ],
      group: ["status"],
      raw: true,
    }),
  ]);

  // ─── 7. WhatsApp Account Stats ───────────────────────────────────
  const [connectedAccounts, disconnectedAccounts] = await Promise.all([
    db.Whatsappaccount.count({
      where: { status: "active", is_deleted: false },
    }),
    db.Whatsappaccount.count({
      where: { status: { [Op.ne]: "active" }, is_deleted: false },
    }),
  ]);

  // ─── 8. Top Tenants by Messages (INNER JOIN to skip deleted tenants) ─────
  const topTenantsQuery = periodStart
    ? `SELECT m.tenant_id, t.company_name, t.status, COUNT(m.id) as messageCount
           FROM messages m
           INNER JOIN tenants t ON m.tenant_id = t.tenant_id
           WHERE m.created_at >= :periodStart
           GROUP BY m.tenant_id, t.company_name, t.status
           ORDER BY messageCount DESC
           LIMIT 5`
    : `SELECT m.tenant_id, t.company_name, t.status, COUNT(m.id) as messageCount
           FROM messages m
           INNER JOIN tenants t ON m.tenant_id = t.tenant_id
           GROUP BY m.tenant_id, t.company_name, t.status
           ORDER BY messageCount DESC
           LIMIT 5`;

  const topTenantsByMessages = await db.sequelize.query(topTenantsQuery, {
    replacements: periodStart ? { periodStart } : {},
    type: Sequelize.QueryTypes.SELECT,
  });

  const topTenantsEnriched = topTenantsByMessages.map((t) => ({
    tenantId: t.tenant_id,
    companyName: t.company_name || "Unknown",
    status: t.status || "unknown",
    messageCount: parseInt(t.messageCount, 10),
  }));

  // ─── 9. Recent Tenant Registrations ──────────────────────────────
  const recentTenants = await db.Tenants.findAll({
    where: { is_deleted: false },
    attributes: [
      "tenant_id",
      "company_name",
      "owner_name",
      "owner_email",
      "status",
      "subscription_plan",
      "created_at",
    ],
    order: [["created_at", "DESC"]],
    limit: 5,
    raw: true,
  });

  // ─── 10. Appointment Stats ───────────────────────────────────────
  const [totalAppointments, appointmentsToday] = await Promise.all([
    db.Appointments.count({ where: { ...periodWhere } }),
    db.Appointments.count({
      where: { created_at: { [Op.gte]: todayAtStart } },
    }),
  ]);

  // ─── 11. Knowledge Base Stats ────────────────────────────────────
  const [totalKnowledgeSources, activeKnowledgeSources] = await Promise.all([
    db.KnowledgeSources.count({}),
    db.KnowledgeSources.count({ where: { status: "active" } }),
  ]);

  // ─── 12. Billing / Wallet Stats ─────────────────────────────────
  const totalWalletBalance = await db.Wallets.findOne({
    attributes: [
      [Sequelize.fn("SUM", Sequelize.col("balance")), "totalBalance"],
    ],
    raw: true,
  });

  // ─── 13. Live Chat Stats ─────────────────────────────────────────
  const [activeChats, totalChatsInPeriod] = await Promise.all([
    db.LiveChat.count({ where: { status: "active" } }),
    db.LiveChat.count({ where: { ...periodWhere } }),
  ]);

  // ─── 15. Daily message volume (last 7 days) ─────────────────────
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  sevenDaysAgo.setHours(0, 0, 0, 0);

  const dailyMessages = await db.sequelize.query(
    `
        SELECT 
            DATE(created_at) as date,
            DAYNAME(created_at) as day,
            COUNT(*) as total
        FROM messages
        WHERE created_at >= :startDate
        GROUP BY DATE(created_at), DAYNAME(created_at)
        ORDER BY DATE(created_at) ASC
    `,
    {
      replacements: { startDate: sevenDaysAgo.toISOString() },
      type: db.sequelize.QueryTypes.SELECT,
    },
  );

  // ─── 16. Subscription Status Distribution ────────────────────────
  const subscriptionDistribution = await db.Tenants.findAll({
    where: { is_deleted: false },
    attributes: [
      "status",
      [Sequelize.fn("COUNT", Sequelize.col("tenant_id")), "count"],
    ],
    group: ["status"],
    raw: true,
  });

  // ─── 17. Expiring Subscriptions (next 7 days) ────────────────────
  const oneWeekFromNow = new Date();
  oneWeekFromNow.setDate(oneWeekFromNow.getDate() + 7);
  const expiringTenants = await db.Tenants.findAll({
    where: {
      is_deleted: false,
      subscription_end_date: {
        [Op.between]: [new Date(), oneWeekFromNow],
      },
    },
    attributes: [
      "tenant_id",
      "company_name",
      "subscription_end_date",
      "status",
    ],
    order: [["subscription_end_date", "ASC"]],
    limit: 5,
    raw: true,
  });

  // ─── 18. Revenue Aggregation ─────────────────────────────────────
  const revenueByCategory = await db.BillingLedger.findAll({
    where: { ...periodWhere },
    attributes: [
      "category",
      [Sequelize.fn("SUM", Sequelize.col("total_cost")), "total"],
      [Sequelize.fn("COUNT", Sequelize.col("id")), "count"],
    ],
    group: ["category"],
    raw: true,
  });

  const topRevenueTenantQuery = periodStart
    ? `SELECT b.tenant_id, t.company_name, SUM(b.total_cost) as totalRevenue
           FROM billing_ledger b
           INNER JOIN tenants t ON b.tenant_id = t.tenant_id
           WHERE b.created_at >= :periodStart
           GROUP BY b.tenant_id, t.company_name
           ORDER BY totalRevenue DESC
           LIMIT 5`
    : `SELECT b.tenant_id, t.company_name, SUM(b.total_cost) as totalRevenue
           FROM billing_ledger b
           INNER JOIN tenants t ON b.tenant_id = t.tenant_id
           GROUP BY b.tenant_id, t.company_name
           ORDER BY totalRevenue DESC
           LIMIT 5`;

  const topRevenueTenants = await db.sequelize.query(topRevenueTenantQuery, {
    replacements: periodStart ? { periodStart } : {},
    type: Sequelize.QueryTypes.SELECT,
  });

  // ─── 19. Platform Live Ops ───────────────────────────────────────
  const [activeChatsByTenant] = await db.sequelize.query(
    `SELECT lc.tenant_id, t.company_name, COUNT(lc.id) as chatCount
         FROM live_chats lc
         INNER JOIN tenants t ON lc.tenant_id = t.tenant_id
         WHERE lc.status = 'active'
         GROUP BY lc.tenant_id, t.company_name
         ORDER BY chatCount DESC
         LIMIT 5`,
  );

  const totalAgents = await db.TenantUsers.count({
    where: { is_deleted: false, role: { [Op.in]: ["agent", "staff"] } },
  });

  const escalationsToday = await db.LiveChat.count({
    where: {
      status: "active",
      assigned_admin_id: { [Op.ne]: null },
      created_at: { [Op.gte]: todayAtStart },
    },
  });

  // ─── 20. WhatsApp Quality Distribution ───────────────────────────
  const whatsappQualityDistribution = await db.Whatsappaccount.findAll({
    where: { is_deleted: false },
    attributes: [
      "quality",
      [Sequelize.fn("COUNT", Sequelize.col("id")), "count"],
    ],
    group: ["quality"],
    raw: true,
  });

  const [warningAccounts] = await db.sequelize.query(
    `SELECT wa.tenant_id, t.company_name, wa.whatsapp_number, wa.quality, wa.status
         FROM whatsapp_accounts wa
         INNER JOIN tenants t ON wa.tenant_id = t.tenant_id
         WHERE wa.is_deleted = false AND wa.quality IN ('YELLOW', 'RED')
         LIMIT 10`,
  );

  // ─── 21. AI Token Usage (Aggregated) ─────────────────────────────
  const aiTokenUsage = await db.AiTokenUsage.findAll({
    where: { ...periodWhere },
    attributes: [
      "model",
      [Sequelize.fn("SUM", Sequelize.col("prompt_tokens")), "totalInput"],
      [Sequelize.fn("SUM", Sequelize.col("completion_tokens")), "totalOutput"],
      [Sequelize.fn("SUM", Sequelize.col("total_tokens")), "totalTokens"],
      [Sequelize.fn("SUM", Sequelize.col("estimated_cost")), "totalCost"],
    ],
    group: ["model"],
    order: [[Sequelize.literal("totalCost"), "DESC"]],
    raw: true,
  });

  const topAiConsumerQuery = periodStart
    ? `SELECT a.tenant_id, t.company_name, SUM(a.total_tokens) as tokensUsed, SUM(a.estimated_cost) as cost
           FROM ai_token_usage a
           INNER JOIN tenants t ON a.tenant_id = t.tenant_id
           WHERE a.created_at >= :periodStart
           GROUP BY a.tenant_id, t.company_name
           ORDER BY cost DESC
           LIMIT 5`
    : `SELECT a.tenant_id, t.company_name, SUM(a.total_tokens) as tokensUsed, SUM(a.estimated_cost) as cost
           FROM ai_token_usage a
           INNER JOIN tenants t ON a.tenant_id = t.tenant_id
           GROUP BY a.tenant_id, t.company_name
           ORDER BY cost DESC
           LIMIT 5`;

  const topAiConsumers = await db.sequelize.query(topAiConsumerQuery, {
    replacements: periodStart ? { periodStart } : {},
    type: Sequelize.QueryTypes.SELECT,
  });

  // ─── 22. Tenant Growth (monthly registrations, last 12 months) ───
  const tenantGrowth = await db.sequelize.query(
    `
        SELECT 
            DATE_FORMAT(created_at, '%Y-%m') as month,
            DATE_FORMAT(created_at, '%b %Y') as label,
            COUNT(*) as newTenants
        FROM tenants
        WHERE is_deleted = false
          AND created_at >= DATE_SUB(NOW(), INTERVAL 12 MONTH)
        GROUP BY DATE_FORMAT(created_at, '%Y-%m'), DATE_FORMAT(created_at, '%b %Y')
        ORDER BY month ASC
    `,
    { type: db.sequelize.QueryTypes.SELECT },
  );

  // ─── 23. Critical Alerts ─────────────────────────────────────────
  const [expiredSubsCount, lowWalletCount, disconnectedWACount] =
    await Promise.all([
      db.Tenants.count({ where: { is_deleted: false, status: "expired" } }),
      db.Wallets.count({ where: { balance: { [Op.lt]: 100 } } }),
      db.Whatsappaccount.count({
        where: {
          is_deleted: false,
          status: { [Op.notIn]: ["active", "verified"] },
        },
      }),
    ]);

  // ─── 24. Recent Platform Activity (last 10 events) ──────────────
  const recentPlatformEvents = [];

  // Recent tenant registrations
  const recentRegs = await db.Tenants.findAll({
    where: { is_deleted: false },
    attributes: ["company_name", "status", "created_at"],
    order: [["created_at", "DESC"]],
    limit: 3,
    raw: true,
  });
  recentRegs.forEach((t) => {
    recentPlatformEvents.push({
      event: "New Organization Registered",
      detail: `${t.company_name} joined the platform`,
      time: t.created_at,
      type: "tenant_registered",
      severity: "success",
    });
  });

  // Recent expired/suspended tenants
  const recentExpired = await db.Tenants.findAll({
    where: { is_deleted: false, status: { [Op.in]: ["expired", "suspended"] } },
    attributes: ["company_name", "status", "updated_at"],
    order: [["updated_at", "DESC"]],
    limit: 3,
    raw: true,
  });
  recentExpired.forEach((t) => {
    recentPlatformEvents.push({
      event:
        t.status === "expired"
          ? "Subscription Expired"
          : "Organization Suspended",
      detail: `${t.company_name} — ${t.status}`,
      time: t.updated_at,
      type:
        t.status === "expired" ? "subscription_expired" : "tenant_suspended",
      severity: "critical",
    });
  });

  // Recent disconnected WhatsApp
  const recentDisconnected = await db.Whatsappaccount.findAll({
    where: {
      is_deleted: false,
      status: { [Op.notIn]: ["active", "verified"] },
    },
    attributes: ["tenant_id", "whatsapp_number", "status", "updated_at"],
    order: [["updated_at", "DESC"]],
    limit: 3,
    raw: true,
  });
  const disconnTenantIds = recentDisconnected.map((a) => a.tenant_id);
  const disconnTenantDetails =
    disconnTenantIds.length > 0
      ? await db.Tenants.findAll({
          where: { tenant_id: disconnTenantIds },
          attributes: ["tenant_id", "company_name"],
          raw: true,
        })
      : [];
  const disconnMap = {};
  disconnTenantDetails.forEach((t) => {
    disconnMap[t.tenant_id] = t;
  });
  recentDisconnected.forEach((a) => {
    recentPlatformEvents.push({
      event: "WhatsApp Disconnected",
      detail: `${disconnMap[a.tenant_id]?.company_name || a.tenant_id} — ${a.whatsapp_number}`,
      time: a.updated_at,
      type: "whatsapp_disconnected",
      severity: "warning",
    });
  });

  // Sort all events by time descending
  recentPlatformEvents.sort((a, b) => new Date(b.time) - new Date(a.time));

  return {
    periodLabel,
    tenants: {
      total: totalTenants,
      active: activeTenants,
      inactive: inactiveTenants,
      deleted: deletedTenants,
      newInPeriod: newTenantsInPeriod,
      newInPrevPeriod: newTenantsInPrevPeriod,
    },
    admins: {
      total: totalAdmins,
      superAdmins: superAdminCount,
      platformAdmins: activePlatformAdmins,
    },
    tenantUsers: {
      total: totalTenantUsers,
      byRole: tenantUsersByRole.map((r) => ({
        role: r.role,
        count: parseInt(r.count, 10),
      })),
    },
    messages: {
      inPeriod: totalMessagesInPeriod,
      inPrevPeriod: totalMessagesInPrevPeriod,
      today: messagesToday,
    },
    leads: {
      total: totalLeads,
      inPeriod: leadsInPeriod,
      inPrevPeriod: leadsInPrevPeriod,
      today: leadsToday,
    },
    campaigns: {
      total: totalCampaigns,
      byStatus: campaignsByStatus.map((c) => ({
        status: c.status,
        count: parseInt(c.count, 10),
      })),
    },
    whatsappAccounts: {
      connected: connectedAccounts,
      disconnected: disconnectedAccounts,
    },
    topTenants: topTenantsEnriched,
    recentTenants: recentTenants.map((t) => ({
      tenantId: t.tenant_id,
      companyName: t.company_name,
      ownerName: t.owner_name,
      ownerEmail: t.owner_email,
      status: t.status,
      plan: t.subscription_plan,
      createdAt: t.created_at,
    })),
    appointments: {
      totalInPeriod: totalAppointments,
      today: appointmentsToday,
    },
    knowledgeBase: {
      total: totalKnowledgeSources,
      active: activeKnowledgeSources,
    },
    billing: {
      totalWalletBalance: parseFloat(totalWalletBalance?.totalBalance || 0),
    },
    liveChats: {
      active: activeChats,
      totalInPeriod: totalChatsInPeriod,
    },
    dailyMessages: dailyMessages.map((d) => ({
      date: d.date,
      day: d.day?.substring(0, 3),
      total: parseInt(d.total, 10),
    })),
    subscriptionDistribution: subscriptionDistribution.map((s) => ({
      status: s.status,
      count: parseInt(s.count, 10),
    })),
    expiringTenants: expiringTenants.map((t) => ({
      tenantId: t.tenant_id,
      companyName: t.company_name,
      expiresAt: t.subscription_end_date,
      status: t.status,
    })),
    revenue: {
      byCategory: revenueByCategory.map((r) => ({
        category: r.category,
        total: parseFloat(r.total || 0),
        count: parseInt(r.count, 10),
      })),
      topTenants: topRevenueTenants.map((t) => ({
        tenantId: t.tenant_id,
        companyName: t.company_name || "Unknown",
        revenue: parseFloat(t.totalRevenue || 0),
      })),
    },
    platformLiveOps: {
      escalationsToday,
      totalAgents,
      topActiveTenants: activeChatsByTenant.map((t) => ({
        tenantId: t.tenant_id,
        companyName: t.company_name || "Unknown",
        activeChats: parseInt(t.chatCount, 10),
      })),
    },
    whatsappQuality: {
      distribution: whatsappQualityDistribution.map((q) => ({
        quality: q.quality,
        count: parseInt(q.count, 10),
      })),
      warningAccounts: warningAccounts.map((a) => ({
        tenantId: a.tenant_id,
        companyName: a.company_name || "Unknown",
        number: a.whatsapp_number,
        quality: a.quality,
        status: a.status,
      })),
    },
    aiTokenUsage: {
      byModel: aiTokenUsage.map((m) => ({
        model: m.model,
        inputTokens: parseInt(m.totalInput || 0, 10),
        outputTokens: parseInt(m.totalOutput || 0, 10),
        totalTokens: parseInt(m.totalTokens || 0, 10),
        cost: parseFloat(m.totalCost || 0),
      })),
      topConsumers: topAiConsumers.map((t) => ({
        tenantId: t.tenant_id,
        companyName: t.company_name || "Unknown",
        tokensUsed: parseInt(t.tokensUsed || 0, 10),
        cost: parseFloat(t.cost || 0),
      })),
    },
    tenantGrowth: tenantGrowth.map((g) => ({
      month: g.month,
      label: g.label,
      newTenants: parseInt(g.newTenants, 10),
    })),
    alerts: {
      expiredSubscriptions: expiredSubsCount,
      lowWalletTenants: lowWalletCount,
      disconnectedWhatsApp: disconnectedWACount,
      total: expiredSubsCount + lowWalletCount + disconnectedWACount,
    },
    platformActivity: recentPlatformEvents.slice(0, 10),
  };
};
