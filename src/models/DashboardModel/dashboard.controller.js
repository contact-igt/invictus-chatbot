import { getDashboardStatsService } from "./dashboard.service.js";

/**
 * Helper: compute human-readable "X min/hrs ago" from a timestamp.
 */
const timeAgo = (date) => {
    if (!date) return "Just now";
    const diffMs = Date.now() - new Date(date).getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHrs = Math.floor(diffMins / 60);
    if (diffHrs < 24) return `${diffHrs}h ago`;
    return `${Math.floor(diffHrs / 24)}d ago`;
};

/**
 * Helper: compute "X min waiting" from last_user_message_at.
 */
const waitingTime = (date) => {
    if (!date) return "0m";
    const diffMins = Math.floor((Date.now() - new Date(date).getTime()) / 60000);
    if (diffMins < 60) return `${diffMins}m`;
    return `${Math.floor(diffMins / 60)}h`;
};

/**
 * Fetch and format dashboard statistics for a specific tenant.
 * Formats according to WhatsNexus Premium Dashboard UI.
 * Endpoint: GET /api/whatsapp/dashboard
 */
export const getDashboardController = async (req, res) => {
    try {
        const { tenantId, period } = req.query;

        if (!tenantId) {
            return res.status(400).send({ message: "tenantId is required" });
        }

        // Fetch Raw Data from Service
        const stats = await getDashboardStatsService(tenantId, period);

        // ─── Trend Calculation for Total Leads ───────────────────────────
        const totalLeadsTrend = stats.kpis.totalLeads.current - stats.kpis.totalLeads.previous;
        const totalLeadsTrendPct = stats.kpis.totalLeads.previous > 0
            ? parseFloat(((totalLeadsTrend / stats.kpis.totalLeads.previous) * 100).toFixed(1))
            : 0;

        // ─── Agent Workload ──────────────────────────────────────────────
        const totalAgentChats = stats.liveOps.agentWorkload.reduce((sum, a) => sum + a.chatCount, 0);
        const agentWorkload = stats.liveOps.agentWorkload.map(agent => ({
            name: agent.name,
            chatCount: agent.chatCount,
            percentage: totalAgentChats > 0
                ? parseFloat(((agent.chatCount / totalAgentChats) * 100).toFixed(1))
                : 0
        }));

        // ─── Hot Leads for Live Operations ───────────────────────────────
        const hotLeads = stats.recent.leads.map(lead => ({
            name: lead.contact?.name || "Anonymous",
            phone: lead.contact?.phone || "",
            score: lead.score || 0,
            heatState: lead.heat_state,
            status: lead.heat_state === "hot" ? "Hot Lead" : "Warm Lead",
            waiting: waitingTime(lead.last_user_message_at)
        }));

        // ─── Recent Activity Feed ────────────────────────────────────────
        const recentActivity = stats.recent.logs.map(log => {
            const eventMap = {
                urgent:            "🚨 Urgent Message Detected",
                missing_knowledge: "📚 Missing Knowledge Flagged",
                out_of_scope:      "⚠️ Out-of-Scope Query",
                sentiment:         "💬 Negative Sentiment Detected"
            };
            return {
                event: eventMap[log.type] || "AI Event",
                detail: log.user_message?.substring(0, 40) || "System Check",
                time: timeAgo(log.created_at),
                type: log.type,
                status: log.status
            };
        });

        // ─── Final Premium Response JSON ─────────────────────────────────
        const responseData = {
            period:   stats.periodLabel,
            wabaInfo: {
                number:  stats.waba?.whatsapp_number || "Not Connected",
                status:  stats.waba?.status === "active" ? "Live" : (stats.waba?.status || "Unknown"),
                quality: stats.waba?.quality || "GREEN",
                region:  stats.waba?.region  || "Global",
                tier:    stats.waba?.tier    || "1K MSG LIMIT",
                rolling24hUsed:  stats.waba?.rolling24hUsed ?? 0,
                sevenDayUnique:  stats.waba?.sevenDayUnique ?? 0
            },
            header: {
                revenueToday:     `₹${stats.header.revenueToday}`,
                newLeadsToday:     stats.header.newLeadsToday,
                resolvedToday:     stats.header.resolvedToday,
                messagesSentToday: stats.header.messagesSent,
                needsAttention:    stats.header.needsAttention
            },
            kpis: {
                totalLeads: {
                    value:  stats.kpis.totalLeads.current,
                    trend:  totalLeadsTrendPct,
                    status: totalLeadsTrendPct >= 10 ? "great" : totalLeadsTrendPct >= 0 ? "good" : "watch"
                },
                newLeadsToday: {
                    value:  stats.header.newLeadsToday,
                    trend:  null,
                    status: "good"
                },
                activeChats: {
                    value:  stats.kpis.activeChats,
                    trend:  null,
                    status: "good"
                },
                aiAutoResolved: {
                    value:  stats.kpis.aiAutoResolvedPct,  // Real %
                    trend:  null,
                    status: stats.kpis.aiAutoResolvedPct >= 70 ? "great" : "good"
                },
                escalatedToAgent: {
                    value:  stats.liveOps.escalatedCount,  // Real count
                    trend:  null,
                    status: stats.liveOps.escalatedCount > 10 ? "watch" : "good"
                },
                appointmentsToday: {
                    value:  stats.kpis.appointmentsToday,  // Real count
                    trend:  null,
                    status: "good"
                }
            },
            liveOperations: {
                hotLeads,
                metrics: {
                    unassigned: stats.liveOps.unassignedCount,  // Real
                    escalated:  stats.liveOps.escalatedCount    // Real
                },
                agentWorkload
            },
            campaigns: stats.campaigns.map(c => ({
                name:      c.campaign_name,
                status:    c.status,
                audience:  c.total_audience,
                delivered: c.delivered_count,
                readPct:   c.delivered_count > 0
                    ? parseFloat(((c.read_count / c.delivered_count) * 100).toFixed(1))
                    : 0,
                replyPct:  c.delivered_count > 0
                    ? parseFloat(((c.replied_count / c.delivered_count) * 100).toFixed(1))
                    : 0
            })),
            recentActivity,

            // ─────────────────────────────────────────────────────────────
            // AGENT PERFORMANCE (Campaigns & Team Performance section)
            // ─────────────────────────────────────────────────────────────
            agentPerformance: {
                agents: stats.agentPerf.agents.map(agent => {
                    // Format avg response seconds → human string "18s" / "2m 4s"
                    const sec = agent.avgResponseSec;
                    const responseTime = sec >= 60
                        ? `${Math.floor(sec / 60)}m ${sec % 60}s`
                        : `${sec}s`;

                    // Progress bar: % of max chats among all agents
                    const maxChats = stats.agentPerf.agents[0]?.chatCount || 1;
                    const barPct   = maxChats > 0
                        ? parseFloat(((agent.chatCount / maxChats) * 100).toFixed(1))
                        : 0;

                    return {
                        name:         agent.name,
                        role:         agent.role,
                        onlineStatus: agent.onlineStatus,  // "online" | "offline"
                        chatCount:    agent.chatCount,
                        responseTime,   // e.g. "18s" or "2m 4s"
                        barPct          // for progress bar width
                    };
                }),
                summary: {
                    peakTime:   stats.agentPerf.peakTime || "N/A",  // e.g. "02:14 PM"
                    active:     `${stats.agentPerf.activeCount}/${stats.agentPerf.totalCount}`,
                    satisfaction: "N/A"  // Placeholder — no satisfaction/rating table yet
                }
            },

            // ─────────────────────────────────────────────────────────────
            // FOLLOW-UP INTELLIGENCE (Follow-Ups & Messaging Volume section)
            // ─────────────────────────────────────────────────────────────
            followUps: {
                dueToday:       stats.followUps.dueToday,
                completedToday: stats.followUps.completedToday,
                overdue:        stats.followUps.overdue,
                handledBy: {
                    aiAutomated:   stats.followUps.aiHandledPct,    // % e.g. 67
                    agentManual:   stats.followUps.agentHandledPct  // % e.g. 33
                },
                upcomingToday: stats.followUps.upcomingToday.map(apt => ({
                    name:    apt.patient_name,
                    time:    apt.appointment_time,  // "12:00:00" — format in UI as "12:00 PM"
                    type:    apt.status,            // "Pending" | "Confirmed"
                    contact: apt.contact_number
                })),
                nurtureEfficiency: {
                    value: stats.followUps.nurtureEfficiency,  // % number
                    grade: stats.followUps.nurtureEfficiency >= 90 ? "High — A+ Grade"
                         : stats.followUps.nurtureEfficiency >= 75 ? "Good — A Grade"
                         : stats.followUps.nurtureEfficiency >= 60 ? "Average — B Grade"
                         : "Low — Needs Improvement"
                }
            },

            // ─────────────────────────────────────────────────────────────
            // MESSAGING ANALYTICS (right panel of Follow-Up section)
            // ─────────────────────────────────────────────────────────────
            messagingAnalytics: {
                totalMessages:   stats.messagingAnalytics.totalThisWeek,
                trendVsLastWeek: stats.messagingAnalytics.trendVsPrevWeek,  // % e.g. +18
                responseRate:    stats.messagingAnalytics.responseRate,     // % e.g. 98.1
                avgPerDay:       stats.messagingAnalytics.avgPerDay,        // e.g. 374
                msgsPerHour:     stats.messagingAnalytics.msgsPerHour,      // e.g. 46
                deliveryRate:    stats.messagingAnalytics.deliveryRate,     // % e.g. 99.3
                failedRate:      stats.messagingAnalytics.failedRate,       // % e.g. 0.7
                // 7-day chart data  →  use for line chart (TOTAL VOLUME + AI HANDLED lines)
                dailyVolume:     stats.messagingAnalytics.dailyVolume
                // each item: { day: "Mon", date: "2026-03-05", total: 400, aiHandled: 280 }
            },

            // ─────────────────────────────────────────────────────────────
            // BILLING & SPEND SUMMARY
            // ─────────────────────────────────────────────────────────────
            billingSummary: {
                totalSpent:      stats.billingSummary.totalSpent,
                marketing:       stats.billingSummary.marketingSpent,
                utility:         stats.billingSummary.utilitySpent,
                authentication:  stats.billingSummary.authSpent,
                totalMessages:   stats.billingSummary.totalMessagesSent,
                billable:        stats.billingSummary.billableConversations,
                free:            stats.billingSummary.freeConversations
            },

            // ─────────────────────────────────────────────────────────────
            // DOCTOR & AVAILABILITY OVERVIEW
            // ─────────────────────────────────────────────────────────────
            doctorOverview: {
                statusBreakdown: (stats.doctorOverview.statusCounts || []).map(r => ({
                    status: r.status,
                    count: parseInt(r.count)
                })),
                totalDoctors: (stats.doctorOverview.statusCounts || []).reduce((s, r) => s + parseInt(r.count), 0),
                specializations: stats.doctorOverview.specializationCount
            },

            // ─────────────────────────────────────────────────────────────
            // KNOWLEDGE BASE HEALTH
            // ─────────────────────────────────────────────────────────────
            knowledgeHealth: {
                totalSources:    stats.knowledgeHealth.totalSources,
                activeSources:   stats.knowledgeHealth.activeSources,
                inactiveSources: stats.knowledgeHealth.inactiveSources,
                totalChunks:     stats.knowledgeHealth.totalChunks,
                sourceTypes:     (stats.knowledgeHealth.sourceTypes || []).map(r => ({
                    type: r.type,
                    count: parseInt(r.count)
                }))
            },

            // ─────────────────────────────────────────────────────────────
            // CONTACT & AUDIENCE OVERVIEW
            // ─────────────────────────────────────────────────────────────
            contactOverview: {
                totalContacts: stats.contactOverview.totalContacts,
                blocked:       stats.contactOverview.blocked,
                aiSilenced:    stats.contactOverview.aiSilenced,
                totalGroups:   stats.contactOverview.totalGroups,
                avgGroupSize:  stats.contactOverview.avgGroupSize
            }

        };

        return res.status(200).send({
            status: "success",
            data: responseData
        });

    } catch (err) {
        console.error("Dashboard Controller Error:", err);
        return res.status(500).send({ message: "An internal server error occurred fetching dashboard data." });
    }
};
