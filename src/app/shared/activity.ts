import { Prisma } from "../../generated/prisma/client.js";
import { IRequestUser } from "../interfaces/requestUser.interface.js";

/**
 * The dashboard's activity feed. `summary` is a sentence frozen at the time of
 * the action, so the feed reads correctly after renames and deletes. Write it in
 * the SAME transaction as the thing it describes, and never put a figure in it
 * that the row itself does not carry.
 */

type Tx = Prisma.TransactionClient;

export interface ActivityInput {
    entityType: string;
    entityId?: string | null;
    action: "created" | "updated" | "deleted" | "converted" | "revealed" | "status_changed";
    summary: string;
}

export const logActivity = async (tx: Tx, entry: ActivityInput, user: IRequestUser) => {
    return tx.activityLog.create({
        data: {
            organization_id: user.organizationId,
            user_id: user.userId,
            entity_type: entry.entityType,
            entity_id: entry.entityId ?? null,
            action: entry.action,
            summary: entry.summary,
        },
    });
};

/**
 * Money inside a summary sentence, plain rather than Intl-formatted: the string
 * is frozen into the row and must not depend on the writing machine's locale.
 */
export const money = (amount: number | Prisma.Decimal, currency: "USD" | "BDT") => {
    const value = typeof amount === "number" ? amount : amount.toNumber();
    const formatted = value.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });
    return currency === "USD" ? `$${formatted}` : `BDT ${formatted}`;
};
