import { getSuperAdminDashboardStatsService } from "./superAdminDashboard.service.js";

/**
 * GET /api/management/dashboard
 * Super Admin / Platform Admin dashboard — platform-wide statistics.
 */
export const getSuperAdminDashboardController = async (req, res) => {
    try {
        const { period = "30days" } = req.query;

        const stats = await getSuperAdminDashboardStatsService(period);

        // ─── Trend Calculations ──────────────────────────────────────
        const tenantTrend = stats.tenants.newInPrevPeriod > 0
            ? parseFloat(((stats.tenants.newInPeriod - stats.tenants.newInPrevPeriod) / stats.tenants.newInPrevPeriod * 100).toFixed(1))
            : 0;

        const messageTrend = stats.messages.inPrevPeriod > 0
            ? parseFloat(((stats.messages.inPeriod - stats.messages.inPrevPeriod) / stats.messages.inPrevPeriod * 100).toFixed(1))
            : 0;

        const leadTrend = stats.leads.inPrevPeriod > 0
            ? parseFloat(((stats.leads.inPeriod - stats.leads.inPrevPeriod) / stats.leads.inPrevPeriod * 100).toFixed(1))
            : 0;

        const responseData = {
            period: stats.periodLabel,

            // ─── KPI Cards ───────────────────────────────────────────
            kpis: {
                totalTenants: {
                    value: stats.tenants.total,
                    active: stats.tenants.active,
                    inactive: stats.tenants.inactive,
                    trend: tenantTrend,
                    status: tenantTrend >= 10 ? "great" : tenantTrend >= 0 ? "good" : "watch",
                },
                totalMessages: {
                    value: stats.messages.inPeriod,
                    today: stats.messages.today,
                    trend: messageTrend,
                    status: messageTrend >= 10 ? "great" : messageTrend >= 0 ? "good" : "watch",
                },
                totalLeads: {
                    value: stats.leads.inPeriod,
                    total: stats.leads.total,
                    today: stats.leads.today,
                    trend: leadTrend,
                    status: leadTrend >= 10 ? "great" : leadTrend >= 0 ? "good" : "watch",
                },
                platformAdmins: {
                    value: stats.admins.total,
                    superAdmins: stats.admins.superAdmins,
                    platformAdmins: stats.admins.platformAdmins,
                    trend: null,
                    status: "good",
                },
                totalTenantUsers: {
                    value: stats.tenantUsers.total,
                    byRole: stats.tenantUsers.byRole,
                    trend: null,
                    status: "good",
                },
                totalCampaigns: {
                    value: stats.campaigns.total,
                    byStatus: stats.campaigns.byStatus,
                    trend: null,
                    status: stats.campaigns.total > 0 ? "good" : "watch",
                },
                whatsappAccounts: {
                    connected: stats.whatsappAccounts.connected,
                    disconnected: stats.whatsappAccounts.disconnected,
                    total: stats.whatsappAccounts.connected + stats.whatsappAccounts.disconnected,
                    trend: null,
                    status: stats.whatsappAccounts.disconnected > 0 ? "watch" : "great",
                },
                liveChats: {
                    active: stats.liveChats.active,
                    totalInPeriod: stats.liveChats.totalInPeriod,
                    trend: null,
                    status: "good",
                },
            },

            // ─── Top Tenants ─────────────────────────────────────────
            topTenants: stats.topTenants,

            // ─── Recent Tenants ──────────────────────────────────────
            recentTenants: stats.recentTenants,

            // ─── Platform Health ─────────────────────────────────────
            platformHealth: {
                appointments: stats.appointments,
                knowledgeBase: stats.knowledgeBase,
                walletBalance: stats.billing.totalWalletBalance,
                aiAnalysis: stats.aiAnalysis,
            },

            // ─── Daily Message Volume (7-day chart) ──────────────────
            dailyMessages: stats.dailyMessages,

            // ─── Subscription Health ─────────────────────────────────
            subscriptionHealth: {
                distribution: stats.subscriptionDistribution,
                expiringSoon: stats.expiringTenants,
            },

            // ─── Revenue Intelligence ────────────────────────────────
            revenue: {
                totalRevenue: stats.revenue.byCategory.reduce((sum, r) => sum + r.total, 0),
                byCategory: stats.revenue.byCategory,
                topTenants: stats.revenue.topTenants,
            },

            // ─── Platform Live Operations ────────────────────────────
            platformLiveOps: {
                activeChatsNow: stats.liveChats.active,
                escalationsToday: stats.platformLiveOps.escalationsToday,
                totalAgents: stats.platformLiveOps.totalAgents,
                agentUtilization: stats.platformLiveOps.totalAgents > 0
                    ? parseFloat(((stats.liveChats.active / stats.platformLiveOps.totalAgents) * 100).toFixed(1))
                    : 0,
                topActiveTenants: stats.platformLiveOps.topActiveTenants,
            },

            // ─── WhatsApp Quality Map ────────────────────────────────
            whatsappQuality: {
                distribution: stats.whatsappQuality.distribution,
                warningAccounts: stats.whatsappQuality.warningAccounts,
            },

            // ─── AI Platform Usage ───────────────────────────────────
            aiUsage: {
                byModel: stats.aiTokenUsage.byModel,
                topConsumers: stats.aiTokenUsage.topConsumers,
                totalTokens: stats.aiTokenUsage.byModel.reduce((sum, m) => sum + m.totalTokens, 0),
                totalCost: stats.aiTokenUsage.byModel.reduce((sum, m) => sum + m.cost, 0),
            },

            // ─── Tenant Growth (12 months) ───────────────────────────
            tenantGrowth: stats.tenantGrowth,

            // ─── Critical Alerts ─────────────────────────────────────
            alerts: stats.alerts,

            // ─── Platform Activity Feed ──────────────────────────────
            platformActivity: stats.platformActivity,
        };

        return res.status(200).send({
            status: "success",
            data: responseData,
        });
    } catch (err) {
        console.error("Super Admin Dashboard Controller Error:", err);
        return res.status(500).send({
            message: "An internal server error occurred fetching dashboard data.",
        });
    }
};
