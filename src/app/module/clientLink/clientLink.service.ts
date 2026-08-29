import status from "http-status";
import { Prisma } from "../../../generated/prisma/client.js";
import { Role } from "../../../generated/prisma/enums.js";
import AppError from "../../errorHelpers/AppError.js";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import { prisma } from "../../lib/prisma.js";
import {
    ICreateClientLinkPayload,
    IUpdateClientLinkPayload,
} from "./clientLink.validation.js";

/**
 * Pointers to where a client's work actually lives.
 *
 * The scoping is the same rule clients themselves follow: operations sees only
 * the clients whose projects they are on, so it sees only those clients'
 * links. Written by reusing the client visibility check rather than
 * reimplementing it - a second copy of that rule is a second thing to get
 * wrong later.
 */

const SELECT = {
    id: true,
    client_id: true,
    label: true,
    url: true,
    notes: true,
    created_at: true,
    client: { select: { id: true, name: true } },
} as const;

/**
 * The client, if this person may see it at all.
 *
 * A 404 rather than a 403 for a client they cannot reach, matching every other
 * scoped read here: which of a company's clients exist is not information to
 * hand out.
 */
const assertClient = async (clientId: string, user: IRequestUser) => {
    const client = await prisma.client.findFirst({
        where: {
            id: clientId,
            organization_id: user.organizationId,
            deleted_at: null,
            ...(user.role === Role.operations
                ? { projects: { some: { members: { some: { user_id: user.userId } } } } }
                : {}),
        },
        select: { id: true },
    });

    if (!client) {
        throw new AppError(status.NOT_FOUND, "Client not found");
    }
};

const getAll = async (user: IRequestUser, filters: { clientId?: string }) => {
    const where: Prisma.ClientLinkWhereInput = {
        organization_id: user.organizationId,
        deleted_at: null,
        ...(filters.clientId ? { client_id: filters.clientId } : {}),
        // Without a client filter, operations would otherwise see every link
        // in the company - the scope has to be on the query, not on the caller
        // remembering to pass a filter.
        ...(user.role === Role.operations
            ? { client: { projects: { some: { members: { some: { user_id: user.userId } } } } } }
            : {}),
    };

    const rows = await prisma.clientLink.findMany({
        where,
        select: SELECT,
        orderBy: { created_at: "desc" },
    });

    return rows;
};

const create = async (payload: ICreateClientLinkPayload, user: IRequestUser) => {
    await assertClient(payload.client_id, user);

    return prisma.clientLink.create({
        data: {
            organization_id: user.organizationId,
            client_id: payload.client_id,
            label: payload.label.trim(),
            url: payload.url.trim(),
            notes: payload.notes ?? "",
            created_by: user.userId,
        },
        select: SELECT,
    });
};

const findOwned = async (id: string, user: IRequestUser) => {
    const link = await prisma.clientLink.findFirst({
        where: {
            id,
            organization_id: user.organizationId,
            deleted_at: null,
            ...(user.role === Role.operations
                ? { client: { projects: { some: { members: { some: { user_id: user.userId } } } } } }
                : {}),
        },
        select: { id: true, label: true },
    });

    if (!link) {
        throw new AppError(status.NOT_FOUND, "Link not found");
    }

    return link;
};

const update = async (id: string, payload: IUpdateClientLinkPayload, user: IRequestUser) => {
    await findOwned(id, user);

    return prisma.clientLink.update({
        where: { id },
        data: {
            ...(payload.label !== undefined ? { label: payload.label.trim() } : {}),
            ...(payload.url !== undefined ? { url: payload.url.trim() } : {}),
            ...(payload.notes !== undefined ? { notes: payload.notes } : {}),
        },
        select: SELECT,
    });
};

const remove = async (id: string, user: IRequestUser) => {
    await findOwned(id, user);

    // Soft, like everything else here, so a mistaken delete is recoverable -
    // and a link somebody spent an afternoon finding is worth that.
    await prisma.clientLink.update({ where: { id }, data: { deleted_at: new Date() } });

    return { message: "Link removed" };
};

export const ClientLinkService = { getAll, create, update, remove };
