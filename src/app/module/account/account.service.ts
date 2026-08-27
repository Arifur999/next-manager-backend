import status from "http-status";
import AppError from "../../errorHelpers/AppError.js";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import { prisma } from "../../lib/prisma.js";
import { getAccountBalances, getBalanceByCurrency } from "../../shared/ledger.js";
import { ICreateAccountPayload, IUpdateAccountPayload } from "./account.validation.js";

// Accounts are always returned WITH their computed balance - an account list
// without balances is not something any screen in the app wants.
const getAllAccounts = async (user: IRequestUser) => {
    const [accounts, balances] = await Promise.all([
        prisma.account.findMany({
            where: { organization_id: user.organizationId, deleted_at: null },
            orderBy: [{ currency: "asc" }, { name: "asc" }],
        }),
        getAccountBalances(user),
    ]);

    const balanceById = new Map(balances.map((entry) => [entry.accountId, entry.balance]));

    return accounts.map((account) => ({
        ...account,
        balance: balanceById.get(account.id) ?? account.opening_balance.toNumber(),
    }));
};

const getBalanceSummary = async (user: IRequestUser) => {
    return getBalanceByCurrency(user);
};

const createAccount = async (payload: ICreateAccountPayload, user: IRequestUser) => {
    const duplicate = await prisma.account.findFirst({
        where: { organization_id: user.organizationId, name: payload.name, deleted_at: null },
    });

    if (duplicate) {
        throw new AppError(status.CONFLICT, "An account with this name already exists");
    }

    return prisma.account.create({
        data: {
            organization_id: user.organizationId,
            name: payload.name,
            type: payload.type,
            currency: payload.currency,
            opening_balance: payload.opening_balance ?? 0,
            notes: payload.notes ?? "",
        },
    });
};

const updateAccount = async (id: string, payload: IUpdateAccountPayload, user: IRequestUser) => {
    const existing = await prisma.account.findFirst({
        where: { id, organization_id: user.organizationId, deleted_at: null },
    });

    if (!existing) {
        throw new AppError(status.NOT_FOUND, "Account not found");
    }

    return prisma.account.update({ where: { id }, data: payload });
};

// Deleting an account with history would orphan its ledger rows and silently
// change every balance total, so an account that has been used can only be
// deactivated.
const deleteAccount = async (id: string, user: IRequestUser) => {
    const existing = await prisma.account.findFirst({
        where: { id, organization_id: user.organizationId, deleted_at: null },
    });

    if (!existing) {
        throw new AppError(status.NOT_FOUND, "Account not found");
    }

    const movementCount = await prisma.accountTransaction.count({
        where: { account_id: id, organization_id: user.organizationId },
    });

    if (movementCount > 0) {
        throw new AppError(
            status.CONFLICT,
            "This account has transactions and cannot be deleted. Deactivate it instead."
        );
    }

    await prisma.account.update({
        where: { id },
        data: { deleted_at: new Date(), is_active: false },
    });

    return { message: "Account deleted successfully" };
};

export const AccountService = {
    getAllAccounts,
    getBalanceSummary,
    createAccount,
    updateAccount,
    deleteAccount,
};
