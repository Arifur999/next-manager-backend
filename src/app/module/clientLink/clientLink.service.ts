import status from "http-status";
import { Prisma } from "../../../generated/prisma/client.js";
import AppError from "../../errorHelpers/AppError.js";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import { prisma } from "../../lib/prisma.js";
import { resolveScope } from "../../shared/resolveScope.js";
import {
    ICreateClientLinkPayload,
    IUpdateClientLinkPayload,
} from "./clientLink.validation.js";

/**
 * Pointers to where a client's work lives, scoped through the clients view
 * scope, so a person sees only the links of clients they can see.
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
 * This person's reach over clients, and so over their links: the CLIENTS scope,
 * because a link belongs to a client and is never granted separately.
 */
const clientScope = async (user: IRequestUser): Promise<Prisma.ClientWhereInput> => {
    const scope = await resolveScope(user, "clients", "view");

    switch (scope) {
        case "all":
            return {};
        case "assigned":
            return { projects: { some: { members: { some: { user_id: user.userId } } } } };
        case "own":
            return { owner_id: user.userId };
        case "none":
        default:
            return { id: { in: [] } };
    }
};

/** The same reach, expressed against the link rows themselves. */
const linkScope = async (user: IRequestUser): Promise<Prisma.ClientLinkWhereInput> => {
    const client = await clientScope(user);
    // The "all" scope has no clause and adds nothing; any other scope filters
    // the link's client.
    return Object.keys(client).length === 0 ? {} : { client };
};

/** The client, if this person may see it at all: 404 otherwise, like every scoped read. */
const assertClient = async (clientId: string, user: IRequestUser) => {
    const client = await prisma.client.findFirst({
        where: {
            id: clientId,
            organization_id: user.organizationId,
            deleted_at: null,
            ...(await clientScope(user)),
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
        // Without a client filter, a narrowed person would otherwise see every
        // link in the company - the scope has to be on the query, not on the
        // caller remembering to pass a filter.
        ...(await linkScope(user)),
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
            ...(await linkScope(user)),
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
