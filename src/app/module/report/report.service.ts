import status from "http-status";
import { Prisma } from "../../../generated/prisma/client.js";
import {
    Currency,
    ExpenseCategoryType,
    LedgerSource,
} from "../../../generated/prisma/enums.js";
import AppError from "../../errorHelpers/AppError.js";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import { prisma } from "../../lib/prisma.js";
import { resolveScope } from "../../shared/resolveScope.js";
import { type ListOptions } from "../../shared/listQuery.js";
import { endOfDay, toDateOnly } from "../../shared/dates.js";

/**
 * Reporting. USD and BDT are never added together: combining them needs a rate,
 * and a rate baked into a headline figure cannot be explained later. The BDT
 * side of income uses each payment's FROZEN reporting rate, so a past period
 * reads the same whenever it is run.
 */

const rangeOf = (options: ListOptions) => {
    const from = options.from ? toDateOnly(options.from) : undefined;
    const to = options.to ? endOfDay(options.to) : undefined;
    return from || to ? { gte: from, lte: to } : undefined;
};

const dateWhere = (options: ListOptions, column = "date") => {
    const range = rangeOf(options);
    return range ? { [column]: range } : {};
};

/** How far this caller's reports reach, from the reports view square. */
const reportScope = (user: IRequestUser) => resolveScope(user, "reports", "view");

/**
 * Profit and loss, cash flow and the monthly series are agency totals: there
 * is no "your share" of them, so anything short of "all" is refused.
 */
const assertWholeAgency = async (user: IRequestUser) => {
    if ((await reportScope(user)) !== "all") {
        throw new AppError(
            status.FORBIDDEN,
            "These figures cover the whole agency. Ask an admin to allow: reports — view, everything."
        );
    }
};

/**
 * Profit and loss. Owner withdrawals and shareholder distributions are not
 * costs: they are earned profit leaving. Borrowed money is not income and
 * repaid principal is not a cost, but loan interest is - which is why an
 * instalment stores the two apart. Employee-type expenses are reported apart,
 * so they read beside team payouts without being counted twice.
 */
const getProfitAndLoss = async (user: IRequestUser, options: ListOptions = {}) => {
    await assertWholeAgency(user);
    const scope = { organization_id: user.organizationId, deleted_at: null, ...dateWhere(options) };

    const [income, expenseByType, payouts, interest] = await Promise.all([
        prisma.payment.aggregate({
            where: scope,
            _sum: { amount_usd: true, amount_bdt_reporting: true },
            _count: true,
        }),
        prisma.expense.findMany({
            where: scope,
            select: { amount_bdt: true, category: { select: { type: true } } },
        }),
        prisma.teamPayout.aggregate({ where: scope, _sum: { amount_bdt: true } }),
        // Interest only - repaid principal settles a liability - and dated by
        // when it was paid, since an overdue instalment has cost nothing yet.
        prisma.loanInstalment.aggregate({
            where: {
                organization_id: user.organizationId,
                loan: { deleted_at: null },
                paid_at: { not: null },
                ...dateWhere(options, "paid_at"),
            },
            _sum: { interest_bdt: true },
        }),
    ]);

    let operatingBdt = 0;
    let employeeBdt = 0;

    for (const expense of expenseByType) {
        const amount = expense.amount_bdt.toNumber();
        if (expense.category.type === ExpenseCategoryType.employee) {
            employeeBdt += amount;
        } else {
            operatingBdt += amount;
        }
    }

    const revenueUsd = income._sum.amount_usd?.toNumber() ?? 0;
    const revenueBdt = income._sum.amount_bdt_reporting?.toNumber() ?? 0;
    const payoutBdt = payouts._sum.amount_bdt?.toNumber() ?? 0;
    const interestBdt = interest._sum.interest_bdt?.toNumber() ?? 0;
    const totalCostBdt = operatingBdt + employeeBdt + payoutBdt + interestBdt;

    return {
        revenue: { usd: revenueUsd, bdt_reporting: revenueBdt, payment_count: income._count },
        cost: {
            operating_expense_bdt: operatingBdt,
            employee_expense_bdt: employeeBdt,
            team_payout_bdt: payoutBdt,
            loan_interest_bdt: interestBdt,
            total_bdt: totalCostBdt,
        },
        // BDT only: it is the one currency in which both sides of this exist.
        net_profit_bdt: revenueBdt - totalCostBdt,
        margin_pct: revenueBdt > 0 ? ((revenueBdt - totalCostBdt) / revenueBdt) * 100 : 0,
    };
};

/**
 * Cash flow, read straight off the ledger: the one place that sees every
 * movement whatever caused it, so it cannot fall out of step with the modules.
 */
const getCashFlow = async (user: IRequestUser, options: ListOptions = {}) => {
    await assertWholeAgency(user);
    const grouped = await prisma.accountTransaction.groupBy({
        by: ["source_type", "currency"],
        where: { organization_id: user.organizationId, ...dateWhere(options) },
        _sum: { amount: true },
    });

    const flows = grouped.map((row) => ({
        source: row.source_type,
        currency: row.currency,
        amount: row._sum.amount?.toNumber() ?? 0,
    }));

    const totals = { USD: { in: 0, out: 0 }, BDT: { in: 0, out: 0 } };

    for (const flow of flows) {
        // An exchange is not income or spending - it is the same money changing
        // shape - but it genuinely moves each wallet, so it stays in the
        // per-currency totals and is flagged rather than hidden.
        const bucket = totals[flow.currency];
        if (flow.amount >= 0) {
            bucket.in += flow.amount;
        } else {
            bucket.out += Math.abs(flow.amount);
        }
    }

    return {
        by_source: flows,
        totals: {
            USD: { ...totals.USD, net: totals.USD.in - totals.USD.out },
            BDT: { ...totals.BDT, net: totals.BDT.in - totals.BDT.out },
        },
        transfer_sources: [LedgerSource.exchange_in, LedgerSource.exchange_out],
    };
};

/**
 * Revenue per client, highest first. Narrowed to the clients the caller brought
 * in when they ask (`mine`) and whenever their reports scope is short of "all"
 * - sales by default - and the payments are filtered as well as the list, so
 * nobody else's revenue is grouped under a null client.
 */
const getClientRevenue = async (
    user: IRequestUser,
    options: ListOptions = {},
    filters: { mine?: boolean } = {}
) => {
    const scope = await reportScope(user);
    if (scope === "none") return [];

    // Forced by the scope, never read from the query alone: a rule that holds
    // only while a parameter is present is not a rule.
    const mine = scope !== "all" || filters.mine;
    const ownScope = mine ? { client: { owner_id: user.userId } } : {};

    const grouped = await prisma.payment.groupBy({
        by: ["client_id"],
        where: {
            organization_id: user.organizationId,
            deleted_at: null,
            ...ownScope,
            ...dateWhere(options),
        },
        _sum: { amount_usd: true, amount_bdt_reporting: true },
        _count: true,
    });

    const clients = await prisma.client.findMany({
        where: {
            organization_id: user.organizationId,
            ...(mine ? { owner_id: user.userId } : {}),
        },
        select: { id: true, name: true, company: true },
    });

    const clientById = new Map(clients.map((client) => [client.id, client]));

    return grouped
        .map((row) => ({
            client: clientById.get(row.client_id) ?? null,
            revenue_usd: row._sum.amount_usd?.toNumber() ?? 0,
            revenue_bdt_reporting: row._sum.amount_bdt_reporting?.toNumber() ?? 0,
            payment_count: row._count,
        }))
        .sort((a, b) => b.revenue_usd - a.revenue_usd);
};

/**
 * Profitability per project, in four grouped queries however many projects
 * there are. A scope short of "all" keeps the projects the caller is on.
 */
const getProjectProfitability = async (user: IRequestUser, options: ListOptions = {}) => {
    const reach = await reportScope(user);
    if (reach === "none") return [];

    const scope = { organization_id: user.organizationId, deleted_at: null, ...dateWhere(options) };
    const membership = reach === "all" ? {} : { members: { some: { user_id: user.userId } } };

    const [projects, payments, expenses, payouts] = await Promise.all([
        prisma.project.findMany({
            where: { organization_id: user.organizationId, deleted_at: null, ...membership },
            select: {
                id: true,
                name: true,
                code: true,
                status: true,
                contract_value_usd: true,
                client: { select: { id: true, name: true } },
            },
        }),
        prisma.payment.groupBy({
            by: ["project_id"],
            where: { ...scope, project_id: { not: null } },
            _sum: { amount_usd: true, amount_bdt_reporting: true },
        }),
        prisma.expense.groupBy({
            by: ["project_id"],
            where: { ...scope, project_id: { not: null } },
            _sum: { amount_bdt: true },
        }),
        prisma.teamPayout.groupBy({
            by: ["project_id"],
            where: { ...scope, project_id: { not: null } },
            _sum: { amount_bdt: true },
        }),
    ]);

    const paymentBy = new Map(payments.map((row) => [row.project_id, row._sum]));
    const expenseBy = new Map(expenses.map((row) => [row.project_id, row._sum.amount_bdt]));
    const payoutBy = new Map(payouts.map((row) => [row.project_id, row._sum.amount_bdt]));

    return projects
        .map((project) => {
            const received = paymentBy.get(project.id);
            const receivedBdt = received?.amount_bdt_reporting?.toNumber() ?? 0;
            const expenseBdt = expenseBy.get(project.id)?.toNumber() ?? 0;
            const payoutBdt = payoutBy.get(project.id)?.toNumber() ?? 0;
            const costBdt = expenseBdt + payoutBdt;

            return {
                project: {
                    id: project.id,
                    name: project.name,
                    code: project.code,
                    status: project.status,
                    client: project.client,
                },
                contract_value_usd: project.contract_value_usd.toNumber(),
                received_usd: received?.amount_usd?.toNumber() ?? 0,
                received_bdt_reporting: receivedBdt,
                expense_bdt: expenseBdt,
                team_payout_bdt: payoutBdt,
                total_cost_bdt: costBdt,
                // Money received minus money spent. Not contract value minus
                // cost - unpaid work is not profit.
                profit_bdt: receivedBdt - costBdt,
                margin_pct: receivedBdt > 0 ? ((receivedBdt - costBdt) / receivedBdt) * 100 : 0,
            };
        })
        .sort((a, b) => b.profit_bdt - a.profit_bdt);
};

/** Monthly revenue and cost for the P&L chart, grouped in SQL rather than row by row in JavaScript. */
const getMonthlySeries = async (user: IRequestUser, months = 12) => {
    await assertWholeAgency(user);
    const start = new Date();
    start.setUTCMonth(start.getUTCMonth() - (months - 1), 1);
    start.setUTCHours(0, 0, 0, 0);

    const [revenue, expense, payout] = await Promise.all([
        prisma.$queryRaw<Array<{ month: Date; usd: Prisma.Decimal; bdt: Prisma.Decimal }>>`
            SELECT date_trunc('month', date) AS month,
                   SUM(amount_usd) AS usd,
                   SUM(amount_bdt_reporting) AS bdt
            FROM payments
            WHERE organization_id = ${user.organizationId}
              AND deleted_at IS NULL
              AND date >= ${start}
            GROUP BY 1 ORDER BY 1`,
        prisma.$queryRaw<Array<{ month: Date; bdt: Prisma.Decimal }>>`
            SELECT date_trunc('month', date) AS month, SUM(amount_bdt) AS bdt
            FROM expenses
            WHERE organization_id = ${user.organizationId}
              AND deleted_at IS NULL
              AND date >= ${start}
            GROUP BY 1 ORDER BY 1`,
        prisma.$queryRaw<Array<{ month: Date; bdt: Prisma.Decimal }>>`
            SELECT date_trunc('month', date) AS month, SUM(amount_bdt) AS bdt
            FROM team_payouts
            WHERE organization_id = ${user.organizationId}
              AND deleted_at IS NULL
              AND date >= ${start}
            GROUP BY 1 ORDER BY 1`,
    ]);

    const key = (value: Date) => value.toISOString().slice(0, 7);

    const revenueBy = new Map(revenue.map((row) => [key(row.month), row]));
    const expenseBy = new Map(expense.map((row) => [key(row.month), row.bdt]));
    const payoutBy = new Map(payout.map((row) => [key(row.month), row.bdt]));

    // Every month in the window appears, including empty ones - a chart that
    // skips quiet months draws a misleadingly smooth line.
    const series = [];
    for (let index = 0; index < months; index += 1) {
        const point = new Date(start);
        point.setUTCMonth(point.getUTCMonth() + index);
        const month = key(point);

        const monthRevenue = revenueBy.get(month);
        const revenueBdt = Number(monthRevenue?.bdt ?? 0);
        const costBdt = Number(expenseBy.get(month) ?? 0) + Number(payoutBy.get(month) ?? 0);

        series.push({
            month,
            revenue_usd: Number(monthRevenue?.usd ?? 0),
            revenue_bdt_reporting: revenueBdt,
            cost_bdt: costBdt,
            profit_bdt: revenueBdt - costBdt,
        });
    }

    return series;
};

export const ReportService = {
    getProfitAndLoss,
    getCashFlow,
    getClientRevenue,
    getProjectProfitability,
    getMonthlySeries,
};

export const REPORT_CURRENCIES = [Currency.USD, Currency.BDT];
