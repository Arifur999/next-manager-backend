import { InvoiceStatus, StatusCategory } from "../../../generated/prisma/enums.js";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import { prisma } from "../../lib/prisma.js";
import { getAccountBalances, getBalanceByCurrency } from "../../shared/ledger.js";

/**
 * The dashboard.
 *
 * Everything here runs in ONE Promise.all rather than a series of awaits: the
 * page shows eight things at once, and eight sequential round-trips is the
 * difference between a dashboard that feels instant and one that does not.
 *
 * Nothing here converts currency. USD and BDT are reported side by side,
 * because adding them needs a rate, and a rate baked into a headline figure is
 * a number nobody can later explain.
 */

// A calendar month in UTC. The date columns are @db.Date, so working in UTC
// keeps the boundaries aligned with how the rows were stored.
const monthBounds = (reference = new Date()) => {
    const start = new Date(Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth(), 1));
    const end = new Date(Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth() + 1, 1));
    return { start, end };
};

const todayBounds = () => {
    const now = new Date();
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 1);
    return { start, end };
};

const getOverview = async (user: IRequestUser) => {
    const organizationId = user.organizationId;
    const { start: monthStart, end: monthEnd } = monthBounds();
    const { start: todayStart, end: todayEnd } = todayBounds();

    const [
        monthRevenue,
        monthExpense,
        balances,
        balanceByCurrency,
        invoiceTotals,
        receivedTotals,
        activeProjects,
        overdueInvoices,
        tasksDueToday,
        recentActivity,
    ] = await Promise.all([
        // Revenue this month, both figures. The BDT one is the sum of each
        // payment's frozen reporting value, not a reconversion at today's rate.
        prisma.payment.aggregate({
            where: {
                organization_id: organizationId,
                deleted_at: null,
                date: { gte: monthStart, lt: monthEnd },
            },
            _sum: { amount_usd: true, amount_bdt_reporting: true },
            _count: true,
        }),

        prisma.expense.aggregate({
            where: {
                organization_id: organizationId,
                deleted_at: null,
                date: { gte: monthStart, lt: monthEnd },
            },
            _sum: { amount_bdt: true },
        }),

        getAccountBalances(user),
        getBalanceByCurrency(user),

        // Receivables: everything billed that is not a draft or cancelled...
        prisma.invoice.aggregate({
            where: {
                organization_id: organizationId,
                deleted_at: null,
                status: { notIn: [InvoiceStatus.draft, InvoiceStatus.cancelled] },
            },
            _sum: { total: true },
        }),

        // ...minus everything received against those invoices. Doing it as two
        // aggregates rather than per-invoice keeps this at a fixed two queries
        // however many invoices exist.
        prisma.payment.aggregate({
            where: { organization_id: organizationId, deleted_at: null, invoice_id: { not: null } },
            _sum: { amount_usd: true },
        }),

        prisma.project.count({
            where: { organization_id: organizationId, deleted_at: null, status: { category: StatusCategory.active } },
        }),

        prisma.invoice.count({
            where: {
                organization_id: organizationId,
                deleted_at: null,
                status: { notIn: [InvoiceStatus.draft, InvoiceStatus.cancelled, InvoiceStatus.paid] },
                due_date: { lt: todayStart },
            },
        }),

        prisma.task.findMany({
            where: {
                organization_id: organizationId,
                deleted_at: null,
                status: { category: { notIn: [StatusCategory.done, StatusCategory.cancelled] } },
                due_date: { gte: todayStart, lt: todayEnd },
            },
            include: {
                project: { select: { id: true, name: true, code: true } },
                assignee: { select: { id: true, full_name: true, avatar_url: true } },
            },
            orderBy: { priority: "desc" },
            take: 20,
        }),

        prisma.activityLog.findMany({
            where: { organization_id: organizationId },
            include: { user: { select: { id: true, full_name: true, avatar_url: true } } },
            orderBy: { created_at: "desc" },
            take: 15,
        }),
    ]);

    const invoicedUsd = invoiceTotals._sum.total?.toNumber() ?? 0;
    const receivedAgainstInvoicesUsd = receivedTotals._sum.amount_usd?.toNumber() ?? 0;

    return {
        month: {
            revenue_usd: monthRevenue._sum.amount_usd?.toNumber() ?? 0,
            revenue_bdt_reporting: monthRevenue._sum.amount_bdt_reporting?.toNumber() ?? 0,
            payment_count: monthRevenue._count,
            expense_bdt: monthExpense._sum.amount_bdt?.toNumber() ?? 0,
        },
        balances,
        balance_by_currency: balanceByCurrency,
        // Floored at zero: an overpayment somewhere is a credit to handle, not
        // a negative receivable that would mask money genuinely owed elsewhere.
        outstanding_receivable_usd: Math.max(invoicedUsd - receivedAgainstInvoicesUsd, 0),
        active_projects: activeProjects,
        overdue_invoices: overdueInvoices,
        tasks_due_today: tasksDueToday,
        recent_activity: recentActivity,
    };
};

export const DashboardService = { getOverview };
