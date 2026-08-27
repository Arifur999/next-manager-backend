import status from "http-status";
import { Prisma } from "../../../generated/prisma/client.js";
import { Currency, LedgerSource } from "../../../generated/prisma/enums.js";
import AppError from "../../errorHelpers/AppError.js";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import { prisma } from "../../lib/prisma.js";
import { logActivity, money } from "../../shared/activity.js";
import { assertAccount, reverseLedgerEntries, writeLedgerEntry } from "../../shared/ledger.js";
import { dateRangeWhere, escapeLikeTerm, pageSlice, type ListOptions } from "../../shared/listQuery.js";
import { ICreateExpensePayload, IUpdateExpensePayload } from "./expense.validation.js";

/**
 * Money out, always BDT - that is the currency the agency actually spends in.
 *
 * An expense may belong to a project, in which case profitability subtracts it;
 * left unassigned it is general overhead.
 */

const toDate = (value: string) => new Date(`${value}T00:00:00.000Z`);

const assertReferences = async (
    tx: Prisma.TransactionClient,
    payload: { category_id?: string; project_id?: string | null },
    user: IRequestUser
) => {
    if (payload.category_id) {
        const category = await tx.expenseCategory.findFirst({
            where: { id: payload.category_id, organization_id: user.organizationId },
            select: { id: true },
        });
        if (!category) throw new AppError(status.NOT_FOUND, "Expense category not found");
    }

    if (payload.project_id) {
        const project = await tx.project.findFirst({
            where: { id: payload.project_id, organization_id: user.organizationId, deleted_at: null },
            select: { id: true },
        });
        if (!project) throw new AppError(status.NOT_FOUND, "Project not found");
    }
};

const getAllExpenses = async (user: IRequestUser, options: ListOptions = {}) => {
    const where: Prisma.ExpenseWhereInput = {
        organization_id: user.organizationId,
        deleted_at: null,
        ...dateRangeWhere(options),
        ...(options.search
            ? {
                OR: [
                    { vendor: { contains: escapeLikeTerm(options.search), mode: "insensitive" } },
                    { notes: { contains: escapeLikeTerm(options.search), mode: "insensitive" } },
                    { category: { name: { contains: escapeLikeTerm(options.search), mode: "insensitive" } } },
                ],
            }
            : {}),
    };

    const include = {
        category: { select: { id: true, name: true, type: true, color: true } },
        account: { select: { id: true, name: true, currency: true } },
        project: { select: { id: true, name: true, code: true } },
    };

    const slice = pageSlice(options);

    if (!slice) {
        const rows = await prisma.expense.findMany({ where, include, orderBy: { date: "desc" } });
        return { rows, total: rows.length };
    }

    const [rows, total] = await Promise.all([
        prisma.expense.findMany({
            where,
            include,
            orderBy: { date: "desc" },
            skip: slice.skip,
            take: slice.take,
        }),
        prisma.expense.count({ where }),
    ]);

    return { rows, total };
};

/** Totals per category for the date range, for the "Expense by Category" report. */
const getCategoryBreakdown = async (user: IRequestUser, options: ListOptions = {}) => {
    const grouped = await prisma.expense.groupBy({
        by: ["category_id"],
        where: {
            organization_id: user.organizationId,
            deleted_at: null,
            ...dateRangeWhere(options),
        },
        _sum: { amount_bdt: true },
        _count: true,
    });

    const categories = await prisma.expenseCategory.findMany({
        where: { organization_id: user.organizationId },
        select: { id: true, name: true, type: true, color: true },
    });

    const categoryById = new Map(categories.map((category) => [category.id, category]));

    return grouped
        .map((row) => ({
            category: categoryById.get(row.category_id) ?? null,
            total_bdt: row._sum.amount_bdt?.toNumber() ?? 0,
            count: row._count,
        }))
        .sort((a, b) => b.total_bdt - a.total_bdt);
};

const createExpense = async (payload: ICreateExpensePayload, user: IRequestUser) => {
    return prisma.$transaction(async (tx) => {
        await assertReferences(tx, payload, user);
        await assertAccount(tx, payload.account_id, user, Currency.BDT);

        const date = toDate(payload.date);

        const expense = await tx.expense.create({
            data: {
                organization_id: user.organizationId,
                date,
                category_id: payload.category_id,
                amount_bdt: payload.amount_bdt,
                account_id: payload.account_id,
                project_id: payload.project_id ?? null,
                vendor: payload.vendor ?? "",
                notes: payload.notes ?? "",
                receipt_url: payload.receipt_url ?? "",
                created_by: user.userId,
            },
        });

        // Negative: money out.
        await writeLedgerEntry(
            tx,
            {
                accountId: payload.account_id,
                date,
                amount: -payload.amount_bdt,
                sourceType: LedgerSource.expense,
                sourceId: expense.id,
                description: payload.vendor || "Expense",
            },
            user,
            Currency.BDT
        );

        const category = await tx.expenseCategory.findUnique({ where: { id: payload.category_id }, select: { name: true } });
        await logActivity(tx, {
            entityType: "expense",
            entityId: expense.id,
            action: "created",
            summary: `Spent ${money(payload.amount_bdt, "BDT")} on ${category?.name ?? "an expense"}`,
        }, user);

        return expense;
    });
};

const updateExpense = async (id: string, payload: IUpdateExpensePayload, user: IRequestUser) => {
    return prisma.$transaction(async (tx) => {
        const existing = await tx.expense.findFirst({
            where: { id, organization_id: user.organizationId, deleted_at: null },
        });

        if (!existing) {
            throw new AppError(status.NOT_FOUND, "Expense not found");
        }

        await assertReferences(tx, payload, user);

        const accountId = payload.account_id ?? existing.account_id;
        await assertAccount(tx, accountId, user, Currency.BDT);

        const date = payload.date ? toDate(payload.date) : existing.date;
        const amount = payload.amount_bdt ?? existing.amount_bdt.toNumber();

        // Only what the ledger cares about triggers a rewrite - editing a note
        // should not produce reversal rows.
        const ledgerChanged =
            accountId !== existing.account_id ||
            amount !== existing.amount_bdt.toNumber() ||
            date.getTime() !== existing.date.getTime();

        if (ledgerChanged) {
            await reverseLedgerEntries(tx, LedgerSource.expense, id, user, "Expense edited");
            await writeLedgerEntry(
                tx,
                {
                    accountId,
                    date,
                    amount: -amount,
                    sourceType: LedgerSource.expense,
                    sourceId: id,
                    description: payload.vendor ?? existing.vendor ?? "Expense",
                },
                user,
                Currency.BDT
            );
        }

        return tx.expense.update({
            where: { id },
            data: {
                date,
                category_id: payload.category_id ?? undefined,
                amount_bdt: amount,
                account_id: accountId,
                project_id: payload.project_id === undefined ? undefined : payload.project_id,
                vendor: payload.vendor ?? undefined,
                notes: payload.notes ?? undefined,
                receipt_url: payload.receipt_url ?? undefined,
            },
        });
    });
};

const deleteExpense = async (id: string, user: IRequestUser) => {
    return prisma.$transaction(async (tx) => {
        const existing = await tx.expense.findFirst({
            where: { id, organization_id: user.organizationId, deleted_at: null },
        });

        if (!existing) {
            throw new AppError(status.NOT_FOUND, "Expense not found");
        }

        await reverseLedgerEntries(tx, LedgerSource.expense, id, user, "Expense deleted");

        await tx.expense.update({
            where: { id },
            data: { deleted_at: new Date(), deleted_by: user.userId },
        });

        return { message: "Expense deleted successfully" };
    });
};

export const ExpenseService = {
    getAllExpenses,
    getCategoryBreakdown,
    createExpense,
    updateExpense,
    deleteExpense,
};
