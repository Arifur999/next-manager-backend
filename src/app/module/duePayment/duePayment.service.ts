import status from "http-status";
import { Prisma } from "../../../generated/prisma/client.js";
import { Currency, DueDirection, LedgerSource } from "../../../generated/prisma/enums.js";
import AppError from "../../errorHelpers/AppError.js";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import { prisma } from "../../lib/prisma.js";
import { assertAccount, reverseLedgerEntries, writeLedgerEntry } from "../../shared/ledger.js";
import { dateRangeWhere, escapeLikeTerm, pageSlice, type ListOptions } from "../../shared/listQuery.js";
import {
    ICreateDuePersonPayload,
    ICreateDueTransactionPayload,
    IUpdateDuePersonPayload,
} from "./duePayment.validation.js";

/**
 * Informal lending, in and out ("DP").
 *
 * Deliberately its own list rather than clients or team members: the balance is
 * personal, and folding it into client revenue or team cost would misstate both.
 *
 * Sign convention, from the agency's point of view:
 *   received -> money came IN  -> account up   -> that person now owes less,
 *                                                 or the agency owes them more
 *   payment  -> money went OUT -> account down -> the reverse
 *
 * The per-person balance is therefore SUM(received) - SUM(payment):
 *   positive -> the agency has taken more from them than it has given back,
 *               so the agency owes them
 *   negative -> they owe the agency
 */

const toDate = (value: string) => new Date(`${value}T00:00:00.000Z`);

/**
 * Every person with their running balance, in two queries rather than one per
 * person - adding a person never adds a query.
 */
const getAllPeople = async (user: IRequestUser, options: ListOptions = {}) => {
    const where: Prisma.DuePersonWhereInput = {
        organization_id: user.organizationId,
        deleted_at: null,
        ...(options.search
            ? {
                OR: [
                    { name: { contains: escapeLikeTerm(options.search), mode: "insensitive" } },
                    { phone: { contains: escapeLikeTerm(options.search), mode: "insensitive" } },
                ],
            }
            : {}),
    };

    const [people, grouped] = await Promise.all([
        prisma.duePerson.findMany({ where, orderBy: { name: "asc" } }),
        prisma.dueTransaction.groupBy({
            by: ["due_person_id", "direction"],
            where: { organization_id: user.organizationId, deleted_at: null },
            _sum: { amount_bdt: true },
        }),
    ]);

    const totals = new Map<string, { received: number; payment: number }>();

    for (const row of grouped) {
        const entry = totals.get(row.due_person_id) ?? { received: 0, payment: 0 };
        const amount = row._sum.amount_bdt?.toNumber() ?? 0;

        if (row.direction === DueDirection.received) {
            entry.received += amount;
        } else {
            entry.payment += amount;
        }

        totals.set(row.due_person_id, entry);
    }

    const rows = people.map((person) => {
        const entry = totals.get(person.id) ?? { received: 0, payment: 0 };
        return {
            ...person,
            total_received_bdt: entry.received,
            total_payment_bdt: entry.payment,
            // Positive: the agency owes them. Negative: they owe the agency.
            balance_bdt: entry.received - entry.payment,
        };
    });

    return { rows, total: rows.length };
};

const createPerson = async (payload: ICreateDuePersonPayload, user: IRequestUser) => {
    return prisma.duePerson.create({
        data: {
            organization_id: user.organizationId,
            name: payload.name,
            phone: payload.phone ?? "",
            notes: payload.notes ?? "",
        },
    });
};

const updatePerson = async (id: string, payload: IUpdateDuePersonPayload, user: IRequestUser) => {
    const existing = await prisma.duePerson.findFirst({
        where: { id, organization_id: user.organizationId, deleted_at: null },
    });

    if (!existing) {
        throw new AppError(status.NOT_FOUND, "Person not found");
    }

    return prisma.duePerson.update({ where: { id }, data: payload });
};

const deletePerson = async (id: string, user: IRequestUser) => {
    const existing = await prisma.duePerson.findFirst({
        where: { id, organization_id: user.organizationId, deleted_at: null },
    });

    if (!existing) {
        throw new AppError(status.NOT_FOUND, "Person not found");
    }

    // Their transactions moved real money through real accounts. Removing the
    // person would leave those ledger rows pointing at nobody, so a person with
    // history stays.
    const transactionCount = await prisma.dueTransaction.count({
        where: { due_person_id: id, organization_id: user.organizationId, deleted_at: null },
    });

    if (transactionCount > 0) {
        throw new AppError(
            status.CONFLICT,
            "This person has due transactions recorded and cannot be deleted."
        );
    }

    await prisma.duePerson.update({ where: { id }, data: { deleted_at: new Date() } });

    return { message: "Person deleted successfully" };
};

const getTransactions = async (user: IRequestUser, personId?: string, options: ListOptions = {}) => {
    const where: Prisma.DueTransactionWhereInput = {
        organization_id: user.organizationId,
        deleted_at: null,
        ...(personId ? { due_person_id: personId } : {}),
        ...dateRangeWhere(options),
    };

    const include = {
        due_person: { select: { id: true, name: true, phone: true } },
        account: { select: { id: true, name: true, currency: true } },
    };

    const slice = pageSlice(options);

    if (!slice) {
        const rows = await prisma.dueTransaction.findMany({ where, include, orderBy: { date: "desc" } });
        return { rows, total: rows.length };
    }

    const [rows, total] = await Promise.all([
        prisma.dueTransaction.findMany({
            where,
            include,
            orderBy: { date: "desc" },
            skip: slice.skip,
            take: slice.take,
        }),
        prisma.dueTransaction.count({ where }),
    ]);

    return { rows, total };
};

const createTransaction = async (payload: ICreateDueTransactionPayload, user: IRequestUser) => {
    return prisma.$transaction(async (tx) => {
        const person = await tx.duePerson.findFirst({
            where: { id: payload.due_person_id, organization_id: user.organizationId, deleted_at: null },
            select: { id: true, name: true },
        });

        if (!person) {
            throw new AppError(status.NOT_FOUND, "Person not found");
        }

        await assertAccount(tx, payload.account_id, user, Currency.BDT);

        const date = toDate(payload.date);
        const isReceived = payload.direction === DueDirection.received;

        const transaction = await tx.dueTransaction.create({
            data: {
                organization_id: user.organizationId,
                due_person_id: payload.due_person_id,
                date,
                direction: payload.direction,
                amount_bdt: payload.amount_bdt,
                account_id: payload.account_id,
                notes: payload.notes ?? "",
                created_by: user.userId,
            },
        });

        await writeLedgerEntry(
            tx,
            {
                accountId: payload.account_id,
                date,
                amount: isReceived ? payload.amount_bdt : -payload.amount_bdt,
                sourceType: isReceived ? LedgerSource.due_received : LedgerSource.due_payment,
                sourceId: transaction.id,
                description: `${isReceived ? "Received from" : "Paid to"} ${person.name}`,
            },
            user,
            Currency.BDT
        );

        return transaction;
    });
};

const deleteTransaction = async (id: string, user: IRequestUser) => {
    return prisma.$transaction(async (tx) => {
        const existing = await tx.dueTransaction.findFirst({
            where: { id, organization_id: user.organizationId, deleted_at: null },
        });

        if (!existing) {
            throw new AppError(status.NOT_FOUND, "Transaction not found");
        }

        const sourceType =
            existing.direction === DueDirection.received
                ? LedgerSource.due_received
                : LedgerSource.due_payment;

        await reverseLedgerEntries(tx, sourceType, id, user, "Due transaction deleted");

        await tx.dueTransaction.update({ where: { id }, data: { deleted_at: new Date() } });

        return { message: "Transaction deleted successfully" };
    });
};

export const DuePaymentService = {
    getAllPeople,
    createPerson,
    updatePerson,
    deletePerson,
    getTransactions,
    createTransaction,
    deleteTransaction,
};
