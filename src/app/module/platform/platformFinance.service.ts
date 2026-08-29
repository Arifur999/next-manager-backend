import status from "http-status";
import { Prisma } from "../../../generated/prisma/client.js";
import { SubscriptionStatus } from "../../../generated/prisma/enums.js";
import AppError from "../../errorHelpers/AppError.js";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import { prisma } from "../../lib/prisma.js";
import { logPlatformActivity } from "../../shared/platformActivity.js";
import {
    ICreatePlatformExpensePayload,
    IUpdatePlatformExpensePayload,
} from "./platform.validation.js";

/**
 * AGENCIO's own books.
 *
 * Nothing here reads a customer's money. Revenue is what the subscriptions
 * say, cost is what this platform spends, and the boundary asserted in the
 * smoke suite - no company balance, no company payment - holds unchanged.
 *
 * Everything is USD, because subscription prices are, and a net figure is
 * meaningless when the two sides are in different currencies. The company
 * books make the same call in the other direction and compute margin in BDT.
 */

const num = (value: Prisma.Decimal | null | undefined) => value?.toNumber() ?? 0;
const round = (value: number) => Math.round(value * 100) / 100;

const EXPENSE_FIELDS = {
    id: true,
    date: true,
    category: true,
    description: true,
    amount_usd: true,
    notes: true,
    created_at: true,
} as const;

// ---------------------------------------------------------------------------
// Expenses
// ---------------------------------------------------------------------------

const getExpenses = async (options: { from?: string; to?: string } = {}) =>
    prisma.platformExpense.findMany({
        where: {
            deleted_at: null,
            ...(options.from || options.to
                ? {
                    date: {
                        ...(options.from ? { gte: new Date(`${options.from}T00:00:00.000Z`) } : {}),
                        ...(options.to ? { lte: new Date(`${options.to}T23:59:59.999Z`) } : {}),
                    },
                }
                : {}),
        },
        select: EXPENSE_FIELDS,
        orderBy: { date: "desc" },
    });

const createExpense = async (payload: ICreatePlatformExpensePayload, user: IRequestUser) =>
    prisma.$transaction(async (tx) => {
        const expense = await tx.platformExpense.create({
            data: {
                date: new Date(`${payload.date}T00:00:00.000Z`),
                category: payload.category ?? "",
                description: payload.description,
                amount_usd: payload.amount_usd,
                notes: payload.notes ?? "",
                created_by: user.userId,
            },
            select: EXPENSE_FIELDS,
        });

        await logPlatformActivity(
            tx,
            {
                entityType: "expense",
                entityId: expense.id,
                action: "created",
                summary: `Recorded $${payload.amount_usd} for ${payload.description}`,
            },
            user
        );

        return expense;
    });

const updateExpense = async (
    id: string,
    payload: IUpdatePlatformExpensePayload,
    user: IRequestUser
) => {
    const existing = await prisma.platformExpense.findFirst({
        where: { id, deleted_at: null },
        select: { id: true, description: true },
    });

    if (!existing) {
        throw new AppError(status.NOT_FOUND, "Expense not found");
    }

    return prisma.$transaction(async (tx) => {
        const expense = await tx.platformExpense.update({
            where: { id },
            data: {
                ...(payload.date !== undefined
                    ? { date: new Date(`${payload.date}T00:00:00.000Z`) }
                    : {}),
                ...(payload.category !== undefined ? { category: payload.category } : {}),
                ...(payload.description !== undefined ? { description: payload.description } : {}),
                ...(payload.amount_usd !== undefined ? { amount_usd: payload.amount_usd } : {}),
                ...(payload.notes !== undefined ? { notes: payload.notes } : {}),
            },
            select: EXPENSE_FIELDS,
        });

        await logPlatformActivity(
            tx,
            {
                entityType: "expense",
                entityId: id,
                action: "updated",
                summary: `Edited the expense "${existing.description}"`,
            },
            user
        );

        return expense;
    });
};

const deleteExpense = async (id: string, user: IRequestUser) => {
    const existing = await prisma.platformExpense.findFirst({
        where: { id, deleted_at: null },
        select: { id: true, description: true, amount_usd: true },
    });

    if (!existing) {
        throw new AppError(status.NOT_FOUND, "Expense not found");
    }

    return prisma.$transaction(async (tx) => {
        await tx.platformExpense.update({ where: { id }, data: { deleted_at: new Date() } });

        await logPlatformActivity(
            tx,
            {
                entityType: "expense",
                entityId: id,
                action: "deleted",
                // The amount is named because the row is now filtered out of
                // every read, so the entry is the only place it survives.
                summary: `Deleted the $${existing.amount_usd} expense "${existing.description}"`,
            },
            user
        );

        return { message: "Expense deleted" };
    });
};

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------

/**
 * Revenue, cost and what is left.
 *
 * `past_due` counts toward revenue: the money is owed, and writing it off the
 * day a card fails hides the thing worth chasing. `trialing` counts as zero,
 * because it is.
 *
 * The expense window defaults to the current month, so "net" compares a
 * monthly recurring figure against a month of costs rather than against
 * everything ever spent.
 */
const getReport = async (options: { from?: string; to?: string } = {}) => {
    const now = new Date();
    const from = options.from
        ? new Date(`${options.from}T00:00:00.000Z`)
        : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const to = options.to
        ? new Date(`${options.to}T23:59:59.999Z`)
        : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59));

    const [paying, byStatus, expenses, churnedInWindow, totalCompanies] = await Promise.all([
        prisma.subscription.findMany({
            where: {
                status: { in: [SubscriptionStatus.active, SubscriptionStatus.past_due] },
            },
            select: { plan: { select: { id: true, name: true, price_usd: true } } },
        }),
        prisma.subscription.groupBy({ by: ["status"], _count: { _all: true } }),
        prisma.platformExpense.aggregate({
            where: { deleted_at: null, date: { gte: from, lte: to } },
            _sum: { amount_usd: true },
            _count: { _all: true },
        }),
        prisma.subscription.count({
            where: {
                status: { in: [SubscriptionStatus.cancelled, SubscriptionStatus.suspended] },
                updated_at: { gte: from, lte: to },
            },
        }),
        prisma.organization.count(),
    ]);

    const mrr = paying.reduce((running, row) => running + num(row.plan.price_usd), 0);
    const costs = num(expenses._sum.amount_usd);

    // Grouped here rather than in SQL: the set is one row per paying company,
    // which is small, and doing it in memory keeps the plan join simple.
    const byPlan = new Map<string, { name: string; companies: number; mrr_usd: number }>();

    for (const row of paying) {
        const entry = byPlan.get(row.plan.id) ?? {
            name: row.plan.name,
            companies: 0,
            mrr_usd: 0,
        };
        entry.companies += 1;
        entry.mrr_usd += num(row.plan.price_usd);
        byPlan.set(row.plan.id, entry);
    }

    const counts = Object.fromEntries(byStatus.map((row) => [row.status, row._count._all]));
    const payingCount = paying.length;

    return {
        from: from.toISOString().slice(0, 10),
        to: to.toISOString().slice(0, 10),
        mrr_usd: round(mrr),
        arr_usd: round(mrr * 12),
        // Null rather than zero with nobody paying: "we earn nothing per
        // customer" and "we have no customers" are different statements.
        arpa_usd: payingCount > 0 ? round(mrr / payingCount) : null,
        expenses_usd: round(costs),
        expense_count: expenses._count._all,
        net_usd: round(mrr - costs),
        paying_companies: payingCount,
        total_companies: totalCompanies,
        churned_in_window: churnedInWindow,
        // Over the companies that were paying plus those that left, which is
        // the only denominator that makes a rate mean anything.
        churn_rate_pct:
            payingCount + churnedInWindow > 0
                ? round((churnedInWindow / (payingCount + churnedInWindow)) * 100)
                : null,
        by_plan: [...byPlan.values()].sort((a, b) => b.mrr_usd - a.mrr_usd),
        by_status: {
            trialing: counts[SubscriptionStatus.trialing] ?? 0,
            active: counts[SubscriptionStatus.active] ?? 0,
            past_due: counts[SubscriptionStatus.past_due] ?? 0,
            suspended: counts[SubscriptionStatus.suspended] ?? 0,
            cancelled: counts[SubscriptionStatus.cancelled] ?? 0,
        },
    };
};

// ---------------------------------------------------------------------------
// The trend
// ---------------------------------------------------------------------------

/**
 * Write down what today looks like.
 *
 * The only way an MRR trend can exist. Subscriptions carry no history, so
 * nothing here can be reconstructed backwards: deriving a line from
 * `created_at` and today's plan price would draw a curve that never dips,
 * because it cannot see anybody who cancelled or downgraded. A chart that
 * cannot go down is not a chart of a business.
 *
 * Upserted on the date, so a cron that fires twice corrects the day rather
 * than doubling it - and a manual run to fill a missed night is safe.
 */
const takeSnapshot = async (when: Date = new Date()) => {
    const date = new Date(Date.UTC(when.getUTCFullYear(), when.getUTCMonth(), when.getUTCDate()));

    const [paying, byStatus, totalCompanies] = await Promise.all([
        prisma.subscription.findMany({
            where: { status: { in: [SubscriptionStatus.active, SubscriptionStatus.past_due] } },
            select: { plan: { select: { price_usd: true } } },
        }),
        prisma.subscription.groupBy({ by: ["status"], _count: { _all: true } }),
        prisma.organization.count(),
    ]);

    const mrr = round(paying.reduce((running, row) => running + num(row.plan.price_usd), 0));
    const counts = Object.fromEntries(byStatus.map((row) => [row.status, row._count._all]));

    const figures = {
        mrr_usd: mrr,
        companies_total: totalCompanies,
        companies_active: counts[SubscriptionStatus.active] ?? 0,
        companies_trialing: counts[SubscriptionStatus.trialing] ?? 0,
        companies_past_due: counts[SubscriptionStatus.past_due] ?? 0,
        companies_suspended: counts[SubscriptionStatus.suspended] ?? 0,
    };

    return prisma.platformMetricSnapshot.upsert({
        where: { date },
        create: { date, ...figures },
        update: figures,
    });
};

/**
 * The trend, and the two things drawn from data that does exist.
 *
 * `mrr` starts on the day snapshots began and is empty before that. Said
 * plainly in `snapshots_since` so the screen can explain an empty chart rather
 * than looking broken.
 *
 * `signups` and `revenue_by_plan` need no history: one is counted from
 * `Organization.created_at`, the other is today's split. Both are real from
 * the first render.
 */
const getTrend = async (days = 90) => {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const [snapshots, organizations, paying] = await Promise.all([
        prisma.platformMetricSnapshot.findMany({
            where: { date: { gte: since } },
            orderBy: { date: "asc" },
        }),
        prisma.organization.findMany({
            where: { created_at: { gte: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000) } },
            select: { created_at: true },
        }),
        prisma.subscription.findMany({
            where: { status: { in: [SubscriptionStatus.active, SubscriptionStatus.past_due] } },
            select: { plan: { select: { id: true, name: true, price_usd: true } } },
        }),
    ]);

    // Companies gained per month, from created_at. Real without any snapshot,
    // because a signup date is a fact the row already carries.
    const signupsByMonth = new Map<string, number>();

    for (const organization of organizations) {
        const month = organization.created_at.toISOString().slice(0, 7);
        signupsByMonth.set(month, (signupsByMonth.get(month) ?? 0) + 1);
    }

    const byPlan = new Map<string, { name: string; companies: number; mrr_usd: number }>();

    for (const row of paying) {
        const entry = byPlan.get(row.plan.id) ?? { name: row.plan.name, companies: 0, mrr_usd: 0 };
        entry.companies += 1;
        entry.mrr_usd += num(row.plan.price_usd);
        byPlan.set(row.plan.id, entry);
    }

    return {
        mrr: snapshots.map((row) => ({
            date: row.date.toISOString().slice(0, 10),
            mrr_usd: num(row.mrr_usd),
            companies_active: row.companies_active,
        })),
        // How much trend there is to look at. Zero is a real state on the day
        // this ships, and the chart says so instead of rendering blank.
        snapshots_since: snapshots[0]?.date.toISOString().slice(0, 10) ?? null,
        signups: [...signupsByMonth.entries()]
            .map(([month, count]) => ({ month, count }))
            .sort((a, b) => a.month.localeCompare(b.month)),
        revenue_by_plan: [...byPlan.values()]
            .map((entry) => ({ ...entry, mrr_usd: round(entry.mrr_usd) }))
            .sort((a, b) => b.mrr_usd - a.mrr_usd),
    };
};

export const PlatformFinanceService = {
    getExpenses,
    createExpense,
    updateExpense,
    deleteExpense,
    getReport,
    takeSnapshot,
    getTrend,
};
