import status from "http-status";
import { Prisma } from "../../../generated/prisma/client.js";
import { ConversationType } from "../../../generated/prisma/enums.js";
import AppError from "../../errorHelpers/AppError.js";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import { prisma } from "../../lib/prisma.js";
import { publishChatEvent } from "../../socket/chatBus.js";
import { pageSlice, type ListOptions } from "../../shared/listQuery.js";
import {
    IAddMembersPayload,
    ICreateConversationPayload,
    ISendMessagePayload,
} from "./chat.validation.js";

/**
 * Talking to each other.
 *
 * One rule decides everything in this file: a row in ConversationMember is the
 * permission, and it is checked against the database on every single read,
 * write and push. Nothing is reached by a client asserting an id, and nothing
 * is cached on a connection - somebody removed from a group stops receiving it
 * at once rather than when they next reconnect.
 *
 * Messages are persisted over HTTP and broadcast over the socket, in that
 * order. A dropped connection therefore loses nothing: the thread is fetched
 * over HTTP when the page opens, and the socket only saves a round trip.
 */

// The fields of a person that a chat screen shows. Never the whole row: an
// unfiltered select carries the password hash to anybody in a group.
const PERSON = { id: true, full_name: true, email: true, role: true, avatar_url: true };

/**
 * Confirms this person is IN the conversation, and that it is their agency's.
 *
 * Both halves matter. The organization check alone would let a colleague read
 * a direct message between two other people; the membership check alone would
 * be enough, but reading both from one query costs nothing and says plainly
 * that neither is optional.
 */
const assertMembership = async (
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
const memberIdsOf = async (
    tx: Prisma.TransactionClient | typeof prisma,
    conversationId: string
) => {
    const members = await tx.conversationMember.findMany({
        where: { conversation_id: conversationId },
        select: { user_id: true },
    });

    return members.map((member) => member.user_id);
};

/**
 * Every conversation this person is in, with how many messages they have not
 * read.
 *
 * Two queries rather than one per conversation: the conversations, and one
 * grouped count of unread messages across all of them. Joining a chat never
 * adds a query.
 */
const getConversations = async (
    user: IRequestUser,
    filters: { type?: ConversationType; unreadOnly?: boolean; archived?: boolean } = {}
) => {
    const memberships = await prisma.conversationMember.findMany({
        where: {
            user_id: user.userId,
            organization_id: user.organizationId,
            conversation: {
                organization_id: user.organizationId,
                ...(filters.type ? { type: filters.type } : {}),
                ...(filters.archived ? { archived_at: { not: null } } : { archived_at: null }),
            },
        },
        select: {
            last_read_at: true,
            conversation: {
                select: {
                    id: true,
                    type: true,
                    name: true,
                    project_id: true,
                    last_message_at: true,
                    archived_at: true,
                    project: { select: { id: true, name: true, code: true } },
                    members: { select: { user: { select: PERSON } } },
                    messages: {
                        where: { deleted_at: null },
                        orderBy: { created_at: "desc" },
                        take: 1,
                        select: {
                            id: true,
                            body: true,
                            created_at: true,
                            sender: { select: { id: true, full_name: true } },
                        },
                    },
                },
            },
        },
        orderBy: { conversation: { last_message_at: "desc" } },
    });

    if (memberships.length === 0) return { rows: [], total: 0 };

    // One grouped count for every conversation at once. Counting per
    // conversation would be a query per row on a screen that lists them all.
    const unreadRows = await prisma.message.groupBy({
        by: ["conversation_id"],
        where: {
            organization_id: user.organizationId,
            deleted_at: null,
            // Somebody's own message is never unread to them.
            sender_id: { not: user.userId },
            OR: memberships.map((membership) => ({
                conversation_id: membership.conversation.id,
                ...(membership.last_read_at ? { created_at: { gt: membership.last_read_at } } : {}),
            })),
        },
        _count: { _all: true },
    });

    const unreadByConversation = new Map(
        unreadRows.map((row) => [row.conversation_id, row._count._all])
    );

    const rows = memberships.map((membership) => {
        const conversation = membership.conversation;
        const people = conversation.members.map((member) => member.user);

        return {
            id: conversation.id,
            type: conversation.type,
            // A direct conversation has no stored name, so it is named here
            // after the other person - which is a different name for each of
            // the two people in it, and the reason it is not a column.
            name:
                conversation.type === ConversationType.direct
                    ? (people.find((person) => person.id !== user.userId)?.full_name ??
                      "Direct message")
                    : conversation.type === ConversationType.project
                      ? (conversation.project?.name ?? conversation.name)
                      : conversation.name,
            project: conversation.project,
            members: people,
            last_message: conversation.messages[0] ?? null,
            last_message_at: conversation.last_message_at,
            archived_at: conversation.archived_at,
            unread_count: unreadByConversation.get(conversation.id) ?? 0,
        };
    });

    const filtered = filters.unreadOnly ? rows.filter((row) => row.unread_count > 0) : rows;

    return { rows: filtered, total: filtered.length };
};

/**
 * Start a conversation.
 *
 * Every member id is checked to be a real, active colleague of the caller
 * before a single row is written. A foreign key would accept a user id from any
 * agency at all, which would put somebody else's employee in this agency's
 * group chat.
 */
const createConversation = async (payload: ICreateConversationPayload, user: IRequestUser) => {
    return prisma.$transaction(async (tx) => {
        const wanted = [...new Set([...payload.member_ids, user.userId])];

        const members = await tx.user.findMany({
            where: { id: { in: wanted }, organization_id: user.organizationId, deleted_at: null },
            select: { id: true },
        });

        // A set check, not a per-id loop: if even one id belongs elsewhere the
        // counts differ, and the whole request is refused.
        if (members.length !== wanted.length) {
            throw new AppError(status.NOT_FOUND, "Somebody on that list is not on your team");
        }

        if (payload.project_id) {
            const project = await tx.project.findFirst({
                where: {
                    id: payload.project_id,
                    organization_id: user.organizationId,
                    deleted_at: null,
                },
                select: { id: true },
            });

            if (!project) {
                throw new AppError(status.NOT_FOUND, "Project not found");
            }
        }

        // Sorted so that A-then-B and B-then-A produce the same key, which is
        // what stops two people opening the same DM from getting two threads
        // and each seeing half the history.
        const directKey =
            payload.type === ConversationType.direct ? [...wanted].sort().join(":") : null;

        if (directKey) {
            const existing = await tx.conversation.findFirst({
                where: { organization_id: user.organizationId, direct_key: directKey },
                select: { id: true },
            });

            // Returned rather than refused: asking to talk to somebody you
            // already have a thread with means open that thread.
            if (existing) return existing;
        }

        const conversation = await tx.conversation.create({
            data: {
                organization_id: user.organizationId,
                type: payload.type,
                name: payload.name?.trim() ?? "",
                project_id: payload.project_id ?? null,
                direct_key: directKey,
                created_by: user.userId,
                members: {
                    create: wanted.map((id) => ({
                        organization_id: user.organizationId,
                        user_id: id,
                    })),
                },
            },
            select: { id: true },
        });

        return conversation;
    });
};

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

    const slice = pageSlice(options);

    if (!slice) {
        const rows = await prisma.message.findMany({
            where,
            include,
            orderBy: { created_at: "asc" },
        });
        return { rows, total: rows.length };
    }

    const [rows, total] = await Promise.all([
        prisma.message.findMany({
            where,
            include,
            orderBy: { created_at: "desc" },
            skip: slice.skip,
            take: slice.take,
        }),
        prisma.message.count({ where }),
    ]);

    // Fetched newest-first for paging, handed back oldest-first for reading.
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
    await publishChatEvent(
        (sql, values) => prisma.$queryRawUnsafe(sql, ...values),
        { recipients, conversationId }
    );

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

const addMembers = async (
    conversationId: string,
    payload: IAddMembersPayload,
    user: IRequestUser
) => {
    return prisma.$transaction(async (tx) => {
        const membership = await assertMembership(tx, conversationId, user);

        // A direct conversation is between two people by definition. Adding a
        // third would silently turn one person's private thread into a group.
        if (membership.conversation.type === ConversationType.direct) {
            throw new AppError(
                status.BAD_REQUEST,
                "A direct conversation is between two people. Start a group instead."
            );
        }

        const members = await tx.user.findMany({
            where: {
                id: { in: payload.member_ids },
                organization_id: user.organizationId,
                deleted_at: null,
            },
            select: { id: true },
        });

        if (members.length !== payload.member_ids.length) {
            throw new AppError(status.NOT_FOUND, "Somebody on that list is not on your team");
        }

        await tx.conversationMember.createMany({
            data: members.map((member) => ({
                organization_id: user.organizationId,
                conversation_id: conversationId,
                user_id: member.id,
            })),
            // Adding somebody already in it is not an error worth showing.
            skipDuplicates: true,
        });

        return { message: "Added" };
    });
};

/** Leaving, and archiving. Both are per-person on a group, never a delete. */
const leave = async (conversationId: string, user: IRequestUser) => {
    await assertMembership(prisma, conversationId, user);

    await prisma.conversationMember.deleteMany({
        where: { conversation_id: conversationId, user_id: user.userId },
    });

    return { message: "You have left the conversation" };
};

const setArchived = async (conversationId: string, archived: boolean, user: IRequestUser) => {
    await assertMembership(prisma, conversationId, user);

    await prisma.conversation.update({
        where: { id: conversationId },
        data: { archived_at: archived ? new Date() : null },
    });

    return { message: archived ? "Archived" : "Restored" };
};

/** How many unread messages this person has anywhere - the navbar's badge. */
const getUnreadTotal = async (user: IRequestUser) => {
    const memberships = await prisma.conversationMember.findMany({
        where: {
            user_id: user.userId,
            organization_id: user.organizationId,
            conversation: { organization_id: user.organizationId, archived_at: null },
        },
        select: { conversation_id: true, last_read_at: true },
    });

    if (memberships.length === 0) return { unread_count: 0 };

    const unread_count = await prisma.message.count({
        where: {
            organization_id: user.organizationId,
            deleted_at: null,
            sender_id: { not: user.userId },
            OR: memberships.map((membership) => ({
                conversation_id: membership.conversation_id,
                ...(membership.last_read_at ? { created_at: { gt: membership.last_read_at } } : {}),
            })),
        },
    });

    return { unread_count };
};

export const ChatService = {
    getConversations,
    createConversation,
    getMessages,
    sendMessage,
    markRead,
    addMembers,
    leave,
    setArchived,
    getUnreadTotal,
};
