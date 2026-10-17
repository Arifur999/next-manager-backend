import status from "http-status";
import { Prisma } from "../../../generated/prisma/client.js";
import AppError from "../../errorHelpers/AppError.js";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import { prisma } from "../../lib/prisma.js";

/**
 * Confirms this person is IN the conversation, and that it is their agency's.
 *
 * Both halves matter. The organization check alone would let a colleague read
 * a direct message between two other people; the membership check alone would
 * be enough, but reading both from one query costs nothing and says plainly
 * that neither is optional.
 */
export const assertMembership = async (
    tx: Prisma.TransactionClient | typeof prisma,
    conversationId: string,
    user: IRequestUser
) => {
    const membership = await tx.conversationMember.findFirst({
        where: {
            conversation_id: conversationId,
            user_id: user.userId,
            organization_id: user.organizationId,
            conversation: { organization_id: user.organizationId },
        },
        select: {
            id: true,
            last_read_at: true,
            conversation: { select: { id: true, type: true, name: true } },
        },
    });

    // The same answer an unknown id gets. Whether a conversation exists that
    // this person is not in is not something they get to learn.
    if (!membership) {
        throw new AppError(status.NOT_FOUND, "Conversation not found");
    }

    return membership;
};

/** The ids of everybody in a conversation, read fresh. The push list. */
export const memberIdsOf = async (
    tx: Prisma.TransactionClient | typeof prisma,
    conversationId: string
) => {
    const members = await tx.conversationMember.findMany({
        where: { conversation_id: conversationId },
        select: { user_id: true },
    });

    return members.map((member) => member.user_id);
};
