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
        const start = new Date(); start.setDate(start.getDate() - 7); start.setHours(0, 0, 0, 0);
        const prev  = new Date(); prev.setDate(prev.getDate() - 14);  prev.setHours(0, 0, 0, 0);
        return { periodStart: start, periodStartPrev: prev, periodLabel: "7 Days" };
    }
    if (period === "alltime") {
        return { periodStart: null, periodStartPrev: null, periodLabel: "All Time" };
    }
    // Default: 30days
    const start = new Date(); start.setDate(start.getDate() - 30); start.setHours(0, 0, 0, 0);
    const prev  = new Date(); prev.setDate(prev.getDate() - 60);   prev.setHours(0, 0, 0, 0);
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
            attributes: ['whatsapp_number', 'status', 'is_verified', 'provider', 'quality', 'region', 'tier'],
            raw: true
        });

        // === 2. Header Metrics (in parallel) ===
        const [newLeadsToday, resolvedToday, messagesSentToday] = await Promise.all([
            db.Leads.count({
                where: { tenant_id: tenantId, created_at: { [Op.gte]: todayAtStart }, is_deleted: false }
            }),
            db.LiveChat.count({
                where: { tenant_id: tenantId, status: 'closed', updated_at: { [Op.gte]: todayAtStart } }
            }),
            db.Messages.count({
                where: {
                    tenant_id: tenantId,
                    sender: { [Op.in]: ['bot', 'admin'] },
                    created_at: { [Op.gte]: todayAtStart }
                }
            })
        ]);

        // === 3. KPI — Total Leads with Trend (compared to previous equivalent period) ===
        const leadsTotalWhere   = { tenant_id: tenantId, is_deleted: false, ...(periodStart ? { created_at: { [Op.gte]: periodStart } } : {}) };
        const leadsPrevWhere    = periodStartPrev
            ? { tenant_id: tenantId, is_deleted: false, created_at: { [Op.gte]: periodStartPrev, [Op.lt]: periodStart } }
            : { tenant_id: tenantId, is_deleted: false, created_at: { [Op.lt]: todayAtStart } };

        const [totalLeadsNow, totalLeadsYesterday] = await Promise.all([
            db.Leads.count({ where: leadsTotalWhere }),
            db.Leads.count({ where: leadsPrevWhere })
        ]);

        // === 4. Active Chats ===
        const activeChats = await db.LiveChat.count({
            where: { tenant_id: tenantId, status: 'active' }
        });

        // === 5. Live Operations — Unassigned & Escalated counts ===
        const [unassignedCount, escalatedCount] = await Promise.all([
            // Unassigned: active chats with no agent assigned
            db.LiveChat.count({
                where: {
                    tenant_id: tenantId,
                    status: 'active',
                    assigned_admin_id: null
                }
            }),
            // Escalated: active chats that have been assigned to a human agent
            db.LiveChat.count({
                where: {
                    tenant_id: tenantId,
                    status: 'active',
                    assigned_admin_id: { [Op.ne]: null }
                }
            })
        ]);

        // === 6. Agent Workload — LiveChat count per agent ===
        const agentChatCounts = await db.LiveChat.findAll({
            where: {
                tenant_id: tenantId,
                status: 'active',
                assigned_admin_id: { [Op.ne]: null }
            },
            attributes: [
                'assigned_admin_id',
                [Sequelize.fn('COUNT', Sequelize.col('id')), 'chatCount']
            ],
            group: ['assigned_admin_id'],
            order: [[Sequelize.literal('chatCount'), 'DESC']],
            limit: 10,
            raw: true
        });

        // Lookup agent names from TenantUsers
        const agentIds = agentChatCounts.map(a => a.assigned_admin_id).filter(Boolean);
        let agentDetails = [];
        if (agentIds.length > 0) {
            agentDetails = await db.TenantUsers.findAll({
                where: { tenant_user_id: { [Op.in]: agentIds }, is_deleted: false },
                attributes: ['tenant_user_id', 'username'],
                raw: true
            });
        }
        const agentMap = {};
        agentDetails.forEach(a => { agentMap[a.tenant_user_id] = a.username; });

        const agentWorkload = agentChatCounts.map(a => ({
            agentId: a.assigned_admin_id,
            name: agentMap[a.assigned_admin_id] || "Unknown Agent",
            chatCount: parseInt(a.chatCount)
        }));

        // === 7. AI Performance — auto-resolved % ===
        const [aiTotalLogs, aiResolvedLogs] = await Promise.all([
            db.AiAnalysisLog.count({ where: { tenant_id: tenantId, is_deleted: false } }),
            db.AiAnalysisLog.count({ where: { tenant_id: tenantId, is_deleted: false, status: 'resolved' } })
        ]);
        const aiAutoResolvedPct = aiTotalLogs > 0
            ? parseFloat(((aiResolvedLogs / aiTotalLogs) * 100).toFixed(1))
            : 0;

        // === 8. AI Analysis type breakdown (for escalatedToAgent KPI) ===
        const aiMetricsQuery = await db.AiAnalysisLog.findAll({
            where: { tenant_id: tenantId, is_deleted: false },
            attributes: [
                'type',
                [Sequelize.fn('COUNT', Sequelize.col('id')), 'count']
            ],
            group: ['type'],
            raw: true
        });

        // === 9. Needs Attention — urgent AI logs pending action ===
        const needsAttention = await db.AiAnalysisLog.count({
            where: {
                tenant_id: tenantId,
                type: 'urgent',
                status: { [Op.in]: ['pending', 'act_on'] },
                is_deleted: false
            }
        });

        // === 10. Conversion Funnel (Leads grouped by Stage, filtered by period) ===
        const funnelWhere = {
            tenant_id: tenantId,
            is_deleted: false,
            ...(periodStart ? { created_at: { [Op.gte]: periodStart } } : {})
        };
        const funnelStats = await db.Leads.findAll({
            where: funnelWhere,
            attributes: [
                'lead_stage',
                [Sequelize.fn('COUNT', Sequelize.col('lead_id')), 'count']
            ],
            group: ['lead_stage'],
            raw: true
        });

        // === 11. Campaigns (latest 5) ===
        const campaigns = await db.WhatsappCampaigns.findAll({
            where: { tenant_id: tenantId, is_deleted: false },
            attributes: ['campaign_name', 'status', 'total_audience', 'delivered_count', 'read_count', 'replied_count'],
            order: [['created_at', 'DESC']],
            limit: 5,
            raw: true
        });

        // === 12. Appointments Today ===
        const appointmentsToday = await db.Appointments.count({
            where: {
                tenant_id: tenantId,
                created_at: { [Op.gte]: todayAtStart }
            }
        });

        // === 13. Recent Activity Feed (Latest Hot Leads + AI Logs) ===
        const [recentLeads, recentAiLogs] = await Promise.all([
            db.Leads.findAll({
                where: {
                    tenant_id: tenantId,
                    is_deleted: false,
                    heat_state: { [Op.in]: ['hot', 'warm'] }
                },
                include: [{ model: db.Contacts, as: 'contact', attributes: ['name', 'phone'] }],
                order: [['last_user_message_at', 'DESC']],
                limit: 5,
                raw: true,
                nest: true
            }),
            db.AiAnalysisLog.findAll({
                where: { tenant_id: tenantId, is_deleted: false },
                order: [['created_at', 'DESC']],
                limit: 5,
                raw: true
            })
        ]);

        // ═══════════════════════════════════════════════════════════════════
        // === 14. AGENT PERFORMANCE ===
        // Per-agent: chat count, avg response time (bot reply wait), status
        // ═══════════════════════════════════════════════════════════════════

        // All active agents for this tenant
        const allAgents = await db.TenantUsers.findAll({
            where: { tenant_id: tenantId, is_deleted: false, role: { [Op.in]: ['agent', 'staff', 'doctor'] } },
            attributes: ['tenant_user_id', 'username', 'status', 'role'],
            raw: true
        });

        // Active chats per agent
        const agentChatCountsPerf = await db.LiveChat.findAll({
            where: { tenant_id: tenantId, status: 'active', assigned_admin_id: { [Op.ne]: null } },
            attributes: [
                'assigned_admin_id',
                [Sequelize.fn('COUNT', Sequelize.col('id')), 'chatCount']
            ],
            group: ['assigned_admin_id'],
            raw: true
        });
        const agentChatMap = {};
        agentChatCountsPerf.forEach(a => { agentChatMap[a.assigned_admin_id] = parseInt(a.chatCount); });

        // Avg response time per agent — avg seconds between last user msg and next admin msg
        // Use Messages: for each contact where sender_id = agent, find time gap
        const agentResponseTimes = await db.sequelize.query(`
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
        `, {
            replacements: {
                tenantId,
                weekStart: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
            },
            type: db.sequelize.QueryTypes.SELECT
        });
        const agentResponseMap = {};
        agentResponseTimes.forEach(r => {
            agentResponseMap[r.agent_id] = Math.round(parseFloat(r.avg_response_sec) || 0);
        });

        // Total active agents (have at least 1 active chat)
        const activeAgentCount = Object.keys(agentChatMap).length;
        const totalAgentCount  = allAgents.length;

        // Peak hour — the hour with most messages sent today by admin/bot
        const [peakHourResult] = await db.sequelize.query(`
            SELECT HOUR(created_at) AS hour, COUNT(*) AS cnt
            FROM messages
            WHERE tenant_id = :tenantId
              AND sender IN ('admin', 'bot')
              AND created_at >= :todayStart
            GROUP BY HOUR(created_at)
            ORDER BY cnt DESC
            LIMIT 1
        `, { replacements: { tenantId, todayStart: todayAtStart.toISOString() }, type: db.sequelize.QueryTypes.SELECT });

        const peakHour = peakHourResult
            ? (() => {
                const h = parseInt(peakHourResult.hour);
                const ampm = h >= 12 ? 'PM' : 'AM';
                const hour12 = h % 12 === 0 ? 12 : h % 12;
                return `${String(hour12).padStart(2, '0')}:00 ${ampm}`;
            })()
            : null;

        // Build agent performance array
        const agentPerformance = allAgents.map(agent => ({
            agentId:         agent.tenant_user_id,
            name:            agent.username,
            role:            agent.role,
            onlineStatus:    agent.status === 'active' ? 'online' : 'offline',
            chatCount:       agentChatMap[agent.tenant_user_id] || 0,
            avgResponseSec:  agentResponseMap[agent.tenant_user_id] || 0
        })).sort((a, b) => b.chatCount - a.chatCount);

        // ═══════════════════════════════════════════════════════════════════
        // === 15. FOLLOW-UP INTELLIGENCE (from Appointments table) ===
        // ═══════════════════════════════════════════════════════════════════
        const todayDateStr = todayAtStart.toISOString().split('T')[0]; // "2026-03-11"

        const [
            followUpDueToday,
            followUpCompletedToday,
            followUpOverdue,
            upcomingAppointments
        ] = await Promise.all([
            // DUE TODAY: appointment_date = today, not yet completed/cancelled
            db.Appointments.count({
                where: {
                    tenant_id: tenantId,
                    appointment_date: todayDateStr,
                    status: { [Op.notIn]: ['Completed', 'Cancelled'] }
                }
            }),
            // COMPLETED TODAY
            db.Appointments.count({
                where: {
                    tenant_id: tenantId,
                    appointment_date: todayDateStr,
                    status: 'Completed'
                }
            }),
            // OVERDUE: appointment_date < today & not completed/cancelled
            db.Appointments.count({
                where: {
                    tenant_id: tenantId,
                    appointment_date: { [Op.lt]: todayDateStr },
                    status: { [Op.notIn]: ['Completed', 'Cancelled'] }
                }
            }),
            // UPCOMING TODAY: sorted by appointment_time
            db.Appointments.findAll({
                where: {
                    tenant_id: tenantId,
                    appointment_date: todayDateStr,
                    status: { [Op.notIn]: ['Completed', 'Cancelled'] }
                },
                attributes: ['patient_name', 'appointment_time', 'status', 'contact_number'],
                order: [['appointment_time', 'ASC']],
                limit: 5,
                raw: true
            })
        ]);

        // AI vs Agent handled — closed chats: null assigned = AI, not-null = Agent
        const [aiHandledChats, agentHandledChats] = await Promise.all([
            db.LiveChat.count({ where: { tenant_id: tenantId, status: 'closed', assigned_admin_id: null } }),
            db.LiveChat.count({ where: { tenant_id: tenantId, status: 'closed', assigned_admin_id: { [Op.ne]: null } } })
        ]);
        const totalHandledChats = aiHandledChats + agentHandledChats;
        const aiHandledPct     = totalHandledChats > 0 ? parseFloat(((aiHandledChats / totalHandledChats) * 100).toFixed(1)) : 0;
        const agentHandledPct  = totalHandledChats > 0 ? parseFloat(((agentHandledChats / totalHandledChats) * 100).toFixed(1)) : 0;

        // Nurture efficiency = AI auto-resolved % (reuse aiAutoResolvedPct)
        const nurtureEfficiency = aiAutoResolvedPct;

        // ═══════════════════════════════════════════════════════════════════
        // === 16. MESSAGING ANALYTICS (7-day window) ===
        // ═══════════════════════════════════════════════════════════════════
        const weekStart = new Date(todayAtStart);
        weekStart.setDate(weekStart.getDate() - 6); // Mon (or 7 days ago)

        const prevWeekStart = new Date(weekStart);
        prevWeekStart.setDate(prevWeekStart.getDate() - 7);

        const [
            totalMsgsThisWeek,
            totalMsgsPrevWeek,
            failedMsgsThisWeek,
            deliveredMsgsThisWeek,
            dailyVolumeRaw
        ] = await Promise.all([
            // Total messages this week
            db.Messages.count({
                where: { tenant_id: tenantId, created_at: { [Op.gte]: weekStart } }
            }),
            // Previous week total for trend
            db.Messages.count({
                where: { tenant_id: tenantId, created_at: { [Op.gte]: prevWeekStart, [Op.lt]: weekStart } }
            }),
            // Failed outgoing messages this week
            db.Messages.count({
                where: {
                    tenant_id: tenantId,
                    created_at: { [Op.gte]: weekStart },
                    sender: { [Op.in]: ['bot', 'admin'] },
                    status: 'failed'
                }
            }),
            // Delivered outgoing messages this week
            db.Messages.count({
                where: {
                    tenant_id: tenantId,
                    created_at: { [Op.gte]: weekStart },
                    sender: { [Op.in]: ['bot', 'admin'] },
                    status: { [Op.in]: ['delivered', 'read'] }
                }
            }),
            // Daily volume per day last 7 days — split bot vs (bot+admin)
            db.sequelize.query(`
                SELECT
                    DATE(created_at) AS day,
                    COUNT(*) AS total,
                    SUM(CASE WHEN sender = 'bot' THEN 1 ELSE 0 END) AS ai_handled
                FROM messages
                WHERE tenant_id = :tenantId
                  AND created_at >= :weekStart
                GROUP BY DATE(created_at)
                ORDER BY day ASC
            `, {
                replacements: { tenantId, weekStart: weekStart.toISOString() },
                type: db.sequelize.QueryTypes.SELECT
            })
        ]);

        // Build full 7-day chart array (fill missing days with 0)
        const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
        const dailyVolumeMap = {};
        dailyVolumeRaw.forEach(r => { dailyVolumeMap[r.day] = r; });

        const dailyVolume = Array.from({ length: 7 }, (_, i) => {
            const d = new Date(weekStart);
            d.setDate(d.getDate() + i);
            const dateStr = d.toISOString().split('T')[0];
            const dayLabel = days[d.getDay() === 0 ? 6 : d.getDay() - 1];
            const row = dailyVolumeMap[dateStr] || {};
            return {
                day:       dayLabel,
                date:      dateStr,
                total:     parseInt(row.total || 0),
                aiHandled: parseInt(row.ai_handled || 0)
            };
        });

        // Outgoing messages this week for rate calculations
        const outgoingThisWeek = deliveredMsgsThisWeek + failedMsgsThisWeek;
        const deliveryRate = outgoingThisWeek > 0
            ? parseFloat(((deliveredMsgsThisWeek / outgoingThisWeek) * 100).toFixed(1)) : 100;
        const failedRate   = outgoingThisWeek > 0
            ? parseFloat(((failedMsgsThisWeek / outgoingThisWeek) * 100).toFixed(1)) : 0;

        // Trend vs previous week
        const msgsTrend = totalMsgsPrevWeek > 0
            ? parseFloat((((totalMsgsThisWeek - totalMsgsPrevWeek) / totalMsgsPrevWeek) * 100).toFixed(1)) : 0;

        // Avg per day & per hour
        const avgPerDay  = Math.round(totalMsgsThisWeek / 7);
        const msgsPerHour = Math.round(totalMsgsThisWeek / (7 * 24));

        // Response rate: messages from bot/admin / total user messages this week
        const [userMsgsThisWeek] = await Promise.all([
            db.Messages.count({
                where: { tenant_id: tenantId, created_at: { [Op.gte]: weekStart }, sender: 'user' }
            })
        ]);
        const botAdminMsgs = totalMsgsThisWeek - userMsgsThisWeek;
        const responseRate = userMsgsThisWeek > 0
            ? parseFloat(((botAdminMsgs / userMsgsThisWeek) * 100).toFixed(1)) : 100;

        // ═══════════════════════════════════════════════════════════════════
        // RETURN ALL DATA
        // ═══════════════════════════════════════════════════════════════════
        return {
            waba: wabaInfo,
            periodLabel,
            header: {
                revenueToday: `38,400`,       // Placeholder — no billing table yet
                newLeadsToday,
                resolvedToday,
                messagesSent: messagesSentToday,
                needsAttention
            },
            kpis: {
                totalLeads: { current: totalLeadsNow, previous: totalLeadsYesterday },
                activeChats,
                aiPerformance: aiMetricsQuery,
                aiAutoResolvedPct,
                appointmentsToday
            },
            liveOps: {
                unassignedCount,
                escalatedCount,
                agentWorkload
            },
            funnel: funnelStats,
            campaigns,
            recent: {
                leads: recentLeads,
                logs: recentAiLogs
            },
            // NEW SECTIONS
            agentPerf: {
                agents:          agentPerformance,
                activeCount:     activeAgentCount,
                totalCount:      totalAgentCount,
                peakTime:        peakHour
            },
            followUps: {
                dueToday:        followUpDueToday,
                completedToday:  followUpCompletedToday,
                overdue:         followUpOverdue,
                aiHandledPct,
                agentHandledPct,
                upcomingToday:   upcomingAppointments,
                nurtureEfficiency
            },
            messagingAnalytics: {
                totalThisWeek:   totalMsgsThisWeek,
                trendVsPrevWeek: msgsTrend,
                avgPerDay,
                msgsPerHour,
                responseRate,
                deliveryRate,
                failedRate,
                dailyVolume      // array of 7 items: { day, date, total, aiHandled }
            }
        };


    } catch (err) {
        console.error("Dashboard Service Error:", err);
        throw err;
    }
};
