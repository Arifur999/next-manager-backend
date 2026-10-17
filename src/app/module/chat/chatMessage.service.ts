import { Prisma } from "../../../generated/prisma/client.js";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import { prisma } from "../../lib/prisma.js";
import { findPage, type ListOptions } from "../../shared/listQuery.js";
import { publishChatEvent } from "../../socket/chatBus.js";
import { assertMembership, memberIdsOf } from "./chat.membership.js";
import { ISendMessagePayload } from "./chat.validation.js";

/**
 * Messages are persisted over HTTP and broadcast over the socket, in that
 * order. A dropped connection therefore loses nothing: the thread is fetched
 * over HTTP when the page opens, and the socket only saves a round trip.
 */

const getMessages = async (
    conversationId: string,
    user: IRequestUser,
    options: ListOptions = {}
) => {
    await assertMembership(prisma, conversationId, user);

    const where: Prisma.MessageWhereInput = {
        conversation_id: conversationId,
        organization_id: user.organizationId,
        deleted_at: null,
    };

    const include = {
        sender: { select: { id: true, full_name: true, avatar_url: true, role: true } },
    };

    // Fetched newest-first so a page is the latest messages, handed back
    // oldest-first for reading.
    const { rows, total } = await findPage(
        options,
        (page) => prisma.message.findMany({ where, include, orderBy: { created_at: "desc" }, ...page }),
        () => prisma.message.count({ where })
    );

    return { rows: rows.reverse(), total };
};

/**
 * Say something.
 *
 * Persisted first, broadcast second, and never the other way round: a message
 * that existed only on a socket would be lost by a dropped connection, and
 * neither person would know.
 */
const sendMessage = async (
    conversationId: string,
    payload: ISendMessagePayload,
    user: IRequestUser
) => {
    const { message, recipients } = await prisma.$transaction(async (tx) => {
        await assertMembership(tx, conversationId, user);

        const created = await tx.message.create({
            data: {
                organization_id: user.organizationId,
                conversation_id: conversationId,
                sender_id: user.userId,
                body: payload.body,
            },
            include: {
                sender: { select: { id: true, full_name: true, avatar_url: true, role: true } },
            },
        });

        // So the conversation list can order by recent activity without
        // joining the whole message table to find a maximum.
        await tx.conversation.update({
            where: { id: conversationId },
            data: { last_message_at: created.created_at },
        });

        // Sending is reading: your own message cannot be unread to you.
        await tx.conversationMember.updateMany({
            where: { conversation_id: conversationId, user_id: user.userId },
            data: { last_read_at: created.created_at },
        });

        return { message: created, recipients: await memberIdsOf(tx, conversationId) };
    });

    // Outside the transaction: publishing must never hold a database
    // transaction open, and the message is already safely stored.
    //
    // Published to the bus rather than pushed to local sockets. Every instance
    // hears it, including this one, so there is one delivery path instead of a
    // local one that works and a remote one that silently does not.
    //
    // A HINT, not the message. The browser refetches rather than trusting what
    // a socket hands it - which is what makes a dropped connection harmless -
    // and a NOTIFY payload is capped at 8000 bytes while a body may be 4000
    // characters. Either reason alone would decide it.
    //
    // The sender is included on purpose: they may have this conversation open
    // in another tab, and that tab should update like anybody else's.
    await publishChatEvent({ recipients, conversationId });

    return message;
};

/** Mark everything up to now as read. */
const markRead = async (conversationId: string, user: IRequestUser) => {
    await assertMembership(prisma, conversationId, user);

    await prisma.conversationMember.updateMany({
        where: { conversation_id: conversationId, user_id: user.userId },
        data: { last_read_at: new Date() },
    });

    return { message: "Marked as read" };
};

export const ChatMessageService = {
    getMessages,
    sendMessage,
    markRead,
};
