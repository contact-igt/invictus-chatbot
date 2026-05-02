import { getDashboardStatsService } from "./dashboard.service.js";

/** Compute "Xm / Xh waiting" from last_user_message_at. */
const waitingTime = (date) => {
    if (!date) return "0m";
    const diffMins = Math.floor((Date.now() - new Date(date).getTime()) / 60000);
    if (diffMins < 60) return `${diffMins}m`;
    return `${Math.floor(diffMins / 60)}h`;
};

/**
 * GET /api/whatsapp/dashboard
 * Fetch and format dashboard statistics for a tenant.
 * Returns a lean response matching exactly what the dashboard UI renders.
 */
export const getDashboardController = async (req, res) => {
    try {
        const { tenantId, startDate, endDate } = req.query;

        // Debug: log every incoming request so date-filter issues are immediately visible in server logs
        console.log("[Dashboard] Incoming request:", { tenantId, startDate, endDate });

        if (!tenantId) {
            return res.status(400).send({ message: "tenantId is required" });
        }

        // Validate YYYY-MM-DD format when provided
        const datePattern = /^\d{4}-\d{2}-\d{2}$/;
        if (startDate && !datePattern.test(startDate)) {
            return res.status(400).send({ message: "startDate must be in YYYY-MM-DD format" });
        }
        if (endDate && !datePattern.test(endDate)) {
            return res.status(400).send({ message: "endDate must be in YYYY-MM-DD format" });
        }
        if (startDate && endDate && startDate > endDate) {
            return res.status(400).send({ message: "startDate must not be after endDate" });
        }

        const stats = await getDashboardStatsService(tenantId, startDate, endDate);

        // ─── Leads trend ──────────────────────────────────────────────────────
        const leadsCurrentCount  = stats.kpis.totalLeads.current;
        const leadsPreviousCount = stats.kpis.totalLeads.previous;
        const leadsAllTimeCount  = stats.kpis.totalLeads.allTime ?? leadsCurrentCount;
        const totalLeadsTrendPct = leadsPreviousCount > 0
            ? parseFloat((((leadsCurrentCount - leadsPreviousCount) / leadsPreviousCount) * 100).toFixed(1))
            : 0;

        // ─── WABA tier normalisation ──────────────────────────────────────────
        const rawTier = stats.waba?.tier || "TIER_NOT_SET";
        const OLD_TIER_MAP = {
            "1K MSG LIMIT":   "TIER_2K",
            "10K MSG LIMIT":  "TIER_10K",
            "100K MSG LIMIT": "TIER_100K",
            "UNLIMITED":      "TIER_UNLIMITED",
        };
        const normalizedTier = rawTier.startsWith("TIER_")
            ? rawTier
            : (OLD_TIER_MAP[rawTier] ?? "TIER_NOT_SET");

        // ─── Live Operations section (only when isLiveMode) ───────────────────
        let liveOperations = null;
        if (stats.liveOps) {
            const hotLeads = stats.liveOps.recentLeads.map(lead => ({
                name:      lead.contact?.name  || "Anonymous",
                phone:     lead.contact?.phone || "",
                score:     lead.score          || 0,
                heatState: lead.heat_state,
                status:    lead.heat_state === "hot" ? "Hot Lead" : "Warm Lead",
                waiting:   waitingTime(lead.last_user_message_at),
            }));

            const totalAgentChats = stats.liveOps.agentWorkload.reduce((s, a) => s + a.chatCount, 0);
            const agentWorkload   = stats.liveOps.agentWorkload.map(agent => ({
                name:       agent.name,
                chatCount:  agent.chatCount,
                percentage: totalAgentChats > 0
                    ? parseFloat(((agent.chatCount / totalAgentChats) * 100).toFixed(1))
                    : 0,
            }));

            liveOperations = {
                hotLeads,
                metrics: {
                    unassigned: stats.liveOps.unassignedCount,
                    escalated:  stats.liveOps.escalatedCount,
                },
                agentWorkload,
            };
        }

        // ─── Follow-ups section (only when isLiveMode) ────────────────────────
        let followUps = null;
        if (stats.followUps) {
            followUps = {
                dueToday:      stats.followUps.dueToday,
                completedToday: stats.followUps.completedToday,
                overdue:       stats.followUps.overdue,
                upcomingToday: stats.followUps.upcomingToday.map(apt => ({
                    name:    apt.patient_name,
                    time:    apt.appointment_time,
                    type:    apt.status,
                    contact: apt.contact_number,
                })),
            };
        }

        // ─── Final lean response ──────────────────────────────────────────────
        const responseData = {
            period:     stats.periodLabel,
            isLiveMode: stats.isLiveMode,

            wabaInfo: {
                number:          stats.waba?.whatsapp_number || "Not Connected",
                status:          stats.waba?.status === "active" ? "Live" : (stats.waba?.status || "Unknown"),
                quality:         stats.waba?.quality          || "GREEN",
                region:          stats.waba?.region           || "Global",
                tier:            normalizedTier,
                rolling24hUsed:  stats.waba?.rolling24hUsed   ?? 0,
                sevenDayUnique:  stats.waba?.sevenDayUnique   ?? 0,
                thirtyDayUnique: stats.waba?.thirtyDayUnique  ?? 0,
            },

            kpis: {
                // Analytics KPIs — always present (all date ranges)
                totalLeads: {
                    value:    leadsCurrentCount,
                    allTime:  leadsAllTimeCount,
                    trend:    totalLeadsTrendPct,
                    status:   totalLeadsTrendPct >= 10 ? "great" : totalLeadsTrendPct >= 0 ? "good" : "watch",
                },
                aiAutoResolved: {
                    value:  stats.kpis.aiAutoResolvedPct,
                    trend:  null,
                    status: stats.kpis.aiAutoResolvedPct >= 70 ? "great" : "good",
                },
                totalCampaigns: stats.kpis.totalCampaigns,
                approvedTemplates: {
                    value:  stats.kpis.approvedTemplates,
                    trend:  null,
                    status: stats.kpis.approvedTemplates > 0 ? "great" : "watch",
                },
                totalFaqs: {
                    value:  stats.kpis.totalFaqs,
                    trend:  null,
                    status: stats.kpis.totalFaqs > 0 ? "good" : "watch",
                },
                // Knowledge + Contacts — period-filtered, flat in kpis (no separate top-level keys)
                knowledgeSources: {
                    value:  stats.kpis.totalSources,
                    trend:  null,
                    status: stats.kpis.totalSources > 0 ? "great" : "watch",
                },
                totalContacts: {
                    value:  stats.kpis.totalContacts,
                    trend:  null,
                    status: stats.kpis.totalContacts > 0 ? "great" : "watch",
                },
                totalGroups: {
                    value:  stats.kpis.totalGroups,
                    trend:  null,
                    status: stats.kpis.totalGroups > 0 ? "good" : "watch",
                },
                // Live & Today KPIs — only present when isLiveMode (endDate >= today)
                // Frontend hides the "Live & Today" KPI section when these are null/absent
                ...(stats.isLiveMode ? {
                    newLeadsToday: {
                        value:  stats.kpis.newLeadsToday,
                        trend:  null,
                        status: "good",
                    },
                    activeChats: {
                        value:  stats.kpis.activeChats,
                        trend:  null,
                        status: "good",
                    },
                    escalatedToAgent: {
                        value:  stats.kpis.escalatedCount,
                        trend:  null,
                        status: stats.kpis.escalatedCount > 10 ? "watch" : "good",
                    },
                    appointmentsToday: {
                        value:  stats.kpis.appointmentsToday,
                        trend:  null,
                        status: "good",
                    },
                } : {}),
            },

            campaigns: stats.campaigns.map(c => ({
                name:      c.campaign_name,
                status:    c.status,
                audience:  c.total_audience,
                delivered: c.delivered_count,
                readPct:   c.delivered_count > 0
                    ? parseFloat(((c.read_count    / c.delivered_count) * 100).toFixed(1)) : 0,
                replyPct:  c.delivered_count > 0
                    ? parseFloat(((c.replied_count / c.delivered_count) * 100).toFixed(1)) : 0,
            })),

            billingSummary: {
                totalSpent:     stats.billingSummary.totalSpent,
                marketing:      stats.billingSummary.marketing,
                utility:        stats.billingSummary.utility,
                authentication: stats.billingSummary.auth,
                service:        stats.billingSummary.service,
                totalMessages:  stats.billingSummary.totalMessages,
                billable:       stats.billingSummary.billable,
                free:           stats.billingSummary.free,
            },

            doctorOverview: {
                statusBreakdown: (stats.doctorOverview.statusCounts || []).map(r => ({
                    status: r.status,
                    count:  parseInt(r.count),
                })),
                totalDoctors: (stats.doctorOverview.statusCounts || [])
                    .reduce((s, r) => s + parseInt(r.count), 0),
                specializations: stats.doctorOverview.specializationCount,
            },

            // Live-mode sections (null when isLiveMode=false)
            liveOperations,
            followUps,
            recentActivity: [],
        };

        // Debug: confirm what values are going back so silent filter-bypass is caught early
        console.log("[Dashboard] Response summary:", {
            period:           responseData.period,
            isLiveMode:       responseData.isLiveMode,
            totalLeads:       responseData.kpis?.totalLeads?.value,
            totalCampaigns:   responseData.kpis?.totalCampaigns,
            billingTotal:     responseData.billingSummary?.totalSpent,
            aiAutoResolved:   responseData.kpis?.aiAutoResolved?.value,
            knowledgeSources: responseData.kpis?.knowledgeSources?.value,
            totalContacts:    responseData.kpis?.totalContacts?.value,
            totalGroups:      responseData.kpis?.totalGroups?.value,
        });

        return res.status(200).send({ status: "success", data: responseData });

    } catch (err) {
        console.error("Dashboard Controller Error:", err);
        return res.status(500).send({ message: "An internal server error occurred fetching dashboard data." });
    }
};
