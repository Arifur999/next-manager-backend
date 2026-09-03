import status from "http-status";
import { Prisma } from "../../../generated/prisma/client.js";
import { Role } from "../../../generated/prisma/enums.js";
import AppError from "../../errorHelpers/AppError.js";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import { prisma } from "../../lib/prisma.js";
import {
    ICreateProjectLinkPayload,
    IUpdateProjectLinkPayload,
} from "./projectLink.validation.js";

/**
 * Pointers to where a project's work actually lives.
 *
 * The scoping is the same rule projects themselves follow: operations sees only
 * the projects they are a member of, so it sees only those projects' links.
 * Written the same way ClientLink writes it, deliberately - a project and a
 * client keep their material the same way, and one pattern is one thing to get
 * right.
 */

const SELECT = {
    id: true,
    project_id: true,
    label: true,
    url: true,
    notes: true,
    created_at: true,
    project: { select: { id: true, name: true, code: true } },
} as const;

/** Operations sees only the projects it is actually on. Everybody else, all. */
const visibilityScope = (user: IRequestUser): Prisma.ProjectWhereInput =>
    user.role === Role.operations
        ? { members: { some: { user_id: user.userId } } }
        : {};

/**
 * The project, if this person may see it at all.
 *
 * A 404 rather than a 403 for a project they cannot reach, matching every other
 * scoped read here: which of a company's projects exist is not information to
 * hand out.
 */
const assertProject = async (projectId: string, user: IRequestUser) => {
    const project = await prisma.project.findFirst({
        where: {
            id: projectId,
            organization_id: user.organizationId,
            deleted_at: null,
            ...visibilityScope(user),
        },
        select: { id: true },
    });

    if (!project) {
        throw new AppError(status.NOT_FOUND, "Project not found");
    }
};

const getAll = async (user: IRequestUser, filters: { projectId?: string }) => {
    const where: Prisma.ProjectLinkWhereInput = {
        organization_id: user.organizationId,
        deleted_at: null,
        ...(filters.projectId ? { project_id: filters.projectId } : {}),
        // Without a project filter, operations would otherwise see every link in
        // the company - the scope has to be on the query, not on the caller
        // remembering to pass a filter.
        ...(user.role === Role.operations
            ? { project: { members: { some: { user_id: user.userId } } } }
            : {}),
    };

    return prisma.projectLink.findMany({
        where,
        select: SELECT,
        orderBy: { created_at: "desc" },
    });
};

const create = async (payload: ICreateProjectLinkPayload, user: IRequestUser) => {
    await assertProject(payload.project_id, user);

    return prisma.projectLink.create({
        data: {
            organization_id: user.organizationId,
            project_id: payload.project_id,
            label: payload.label.trim(),
            url: payload.url.trim(),
            notes: payload.notes ?? "",
            created_by: user.userId,
        },
        select: SELECT,
    });
};

const findOwned = async (id: string, user: IRequestUser) => {
    const link = await prisma.projectLink.findFirst({
        where: {
            id,
            organization_id: user.organizationId,
            deleted_at: null,
            ...(user.role === Role.operations
                ? { project: { members: { some: { user_id: user.userId } } } }
                : {}),
        },
        select: { id: true, label: true },
    });

    if (!link) {
        throw new AppError(status.NOT_FOUND, "Link not found");
    }

    return link;
};

const update = async (id: string, payload: IUpdateProjectLinkPayload, user: IRequestUser) => {
    await findOwned(id, user);

    return prisma.projectLink.update({
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
    await prisma.projectLink.update({ where: { id }, data: { deleted_at: new Date() } });

    return { message: "Link removed" };
};

export const ProjectLinkService = { getAll, create, update, remove };
