import status from "http-status";
import { Prisma } from "../../../generated/prisma/client.js";
import { Currency, LedgerSource } from "../../../generated/prisma/enums.js";
import AppError from "../../errorHelpers/AppError.js";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import { prisma } from "../../lib/prisma.js";
import { logActivity, money } from "../../shared/activity.js";
import { assertAccount, reverseLedgerEntries, writeLedgerEntry } from "../../shared/ledger.js";
import { dateRangeWhere, pageSlice, type ListOptions } from "../../shared/listQuery.js";
import { ICreateTeamPayoutPayload, IUpdateTeamPayoutPayload } from "./teamPayout.validation.js";

/**
 * What the agency pays its own people, in BDT.
 *
 * A payout tied to a project counts as that project's team cost, which is what
 * project profitability subtracts alongside project expenses. Untied payouts
 * (a monthly salary, say) are general cost and belong to no single project.
 */

const toDate = (value: string) => new Date(`${value}T00:00:00.000Z`);

const assertReferences = async (
    tx: Prisma.TransactionClient,
    payload: { user_id?: string; project_id?: string | null },
    user: IRequestUser
) => {
    if (payload.user_id) {
        const member = await tx.user.findFirst({
            where: { id: payload.user_id, organization_id: user.organizationId, deleted_at: null },
            select: { id: true },
        });
        if (!member) throw new AppError(status.NOT_FOUND, "Team member not found");
    }

    if (payload.project_id) {
        const project = await tx.project.findFirst({
            where: { id: payload.project_id, organization_id: user.organizationId, deleted_at: null },
            select: { id: true },
        });
        if (!project) throw new AppError(status.NOT_FOUND, "Project not found");
    }
};

const getAllPayouts = async (user: IRequestUser, options: ListOptions = {}) => {
    const where: Prisma.TeamPayoutWhereInput = {
        organization_id: user.organizationId,
        deleted_at: null,
        ...dateRangeWhere(options),
    };

    const include = {
        user: { select: { id: true, full_name: true, email: true, avatar_url: true } },
        project: { select: { id: true, name: true, code: true } },
        account: { select: { id: true, name: true, currency: true } },
    };

    const slice = pageSlice(options);

    if (!slice) {
        const rows = await prisma.teamPayout.findMany({ where, include, orderBy: { date: "desc" } });
        return { rows, total: rows.length };
    }

    const [rows, total] = await Promise.all([
        prisma.teamPayout.findMany({
            where,
            include,
            orderBy: { date: "desc" },
            skip: slice.skip,
            take: slice.take,
        }),
        prisma.teamPayout.count({ where }),
    ]);

    return { rows, total };
};

const createPayout = async (payload: ICreateTeamPayoutPayload, user: IRequestUser) => {
    return prisma.$transaction(async (tx) => {
        await assertReferences(tx, payload, user);
        await assertAccount(tx, payload.account_id, user, Currency.BDT);

        const date = toDate(payload.date);

        const payout = await tx.teamPayout.create({
            data: {
                organization_id: user.organizationId,
                date,
                user_id: payload.user_id,
                project_id: payload.project_id ?? null,
                amount_bdt: payload.amount_bdt,
                type: payload.type,
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
                amount: -payload.amount_bdt,
                sourceType: LedgerSource.team_payout,
                sourceId: payout.id,
                description: `Team payout (${payload.type})`,
            },
            user,
            Currency.BDT
        );

        return payout;
    });
};

const updatePayout = async (id: string, payload: IUpdateTeamPayoutPayload, user: IRequestUser) => {
    return prisma.$transaction(async (tx) => {
        const existing = await tx.teamPayout.findFirst({
            where: { id, organization_id: user.organizationId, deleted_at: null },
        });

        if (!existing) {
            throw new AppError(status.NOT_FOUND, "Payout not found");
        }

        await assertReferences(tx, payload, user);

        const accountId = payload.account_id ?? existing.account_id;
        await assertAccount(tx, accountId, user, Currency.BDT);

        const date = payload.date ? toDate(payload.date) : existing.date;
        const amount = payload.amount_bdt ?? existing.amount_bdt.toNumber();

        const ledgerChanged =
            accountId !== existing.account_id ||
            amount !== existing.amount_bdt.toNumber() ||
            date.getTime() !== existing.date.getTime();

        if (ledgerChanged) {
            await reverseLedgerEntries(tx, LedgerSource.team_payout, id, user, "Payout edited");
            await writeLedgerEntry(
                tx,
                {
                    accountId,
                    date,
                    amount: -amount,
                    sourceType: LedgerSource.team_payout,
                    sourceId: id,
                    description: `Team payout (${payload.type ?? existing.type})`,
                },
                user,
                Currency.BDT
            );
        }

        return tx.teamPayout.update({
            where: { id },
            data: {
                date,
                user_id: payload.user_id ?? undefined,
                project_id: payload.project_id === undefined ? undefined : payload.project_id,
                amount_bdt: amount,
                type: payload.type ?? undefined,
                account_id: accountId,
                notes: payload.notes ?? undefined,
            },
        });
    });
};

const deletePayout = async (id: string, user: IRequestUser) => {
    return prisma.$transaction(async (tx) => {
        const existing = await tx.teamPayout.findFirst({
            where: { id, organization_id: user.organizationId, deleted_at: null },
        });

        if (!existing) {
            throw new AppError(status.NOT_FOUND, "Payout not found");
        }

        await reverseLedgerEntries(tx, LedgerSource.team_payout, id, user, "Payout deleted");

        await tx.teamPayout.update({
            where: { id },
            data: { deleted_at: new Date(), deleted_by: user.userId },
        });

        // The amount is named in the summary because the row it came from is
        // now soft-deleted and every list filters it out. Without it the entry
        // reads "a payout was deleted" and answers nothing.
        await logActivity(
            tx,
            {
                entityType: "team_payout",
                entityId: id,
                action: "deleted",
                summary: `Deleted a team payout of ${money(existing.amount_bdt, "BDT")}`,
            },
            user
        );

        return { message: "Payout deleted successfully" };
    });
};

export const TeamPayoutService = {
    getAllPayouts,
    createPayout,
    updatePayout,
    deletePayout,
};
