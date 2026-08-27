import { Prisma } from "../../generated/prisma/client.js";
import { IRequestUser } from "../interfaces/requestUser.interface.js";

/**
 * The dashboard's activity feed.
 *
 * `summary` is written at the time of the action and never recomputed, so the
 * feed still reads correctly after the thing it describes has been renamed or
 * deleted. That is the whole reason it is a stored sentence rather than a join.
 *
 * Two rules for callers:
 *
 *   1. Write it in the SAME transaction as the thing it describes. An entry for
 *      a payment that then failed to save is worse than no entry.
 *   2. Never put a figure in the summary that the row itself does not carry —
 *      the feed is a record of what happened, not a second place for money to
 *      be stated and drift.
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
 * Money amounts inside a summary sentence.
 *
 * Deliberately plain rather than Intl-formatted: this string is frozen into the
 * row, and a locale-dependent format would mean two entries written on
 * different machines read differently forever.
 */
export const money = (amount: number | Prisma.Decimal, currency: "USD" | "BDT") => {
    const value = typeof amount === "number" ? amount : amount.toNumber();
    const formatted = value.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });
    return currency === "USD" ? `$${formatted}` : `BDT ${formatted}`;
};
