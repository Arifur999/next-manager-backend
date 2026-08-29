import { Prisma } from "../../generated/prisma/client.js";
import { IRequestUser } from "../interfaces/requestUser.interface.js";

/**
 * Recording what a platform operator did.
 *
 * The company-side twin of shared/activity.ts, and it follows the same two
 * rules for the same reasons:
 *
 *   1. Write it in the SAME transaction as the thing it describes. An entry
 *      for a suspension that then failed to save is worse than no entry.
 *   2. The summary is a sentence frozen at the time of the action, never a
 *      join resolved later - so it still reads correctly after the company it
 *      names has been renamed, or has left.
 *
 * Names the company rather than only its id, because "suspended
 * a4f2-…-9c1b" answers nothing an operator scanning the feed is asking.
 */

type Tx = Prisma.TransactionClient;

export interface PlatformActivityInput {
    entityType: "company" | "plan" | "subscription" | "admin" | "campaign" | "expense";
    entityId?: string | null;
    action: "created" | "updated" | "deleted" | "status_changed" | "invited" | "sent";
    summary: string;
}

export const logPlatformActivity = async (
    tx: Tx,
    entry: PlatformActivityInput,
    user: IRequestUser
) =>
    tx.platformActivityLog.create({
        data: {
            actor_id: user.userId,
            entity_type: entry.entityType,
            entity_id: entry.entityId ?? null,
            action: entry.action,
            summary: entry.summary,
        },
    });
