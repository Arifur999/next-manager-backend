import status from "http-status";
import { StatusCategory, WorkflowKind } from "../../../generated/prisma/enums.js";
import AppError from "../../errorHelpers/AppError.js";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import { prisma } from "../../lib/prisma.js";
import { logActivity } from "../../shared/activity.js";
import {
    ICreateWorkflowStatusPayload,
    IUpdateWorkflowStatusPayload,
} from "./workflowStatus.validation.js";

/**
 * The columns on an agency's boards.
 *
 * The name is theirs. The category is what the product reasons about - four
 * places derive behaviour from it rather than from the name, so "Done" renamed
 * to "Shipped" still stops the clock and a new "In QA" still counts as work in
 * flight.
 *
 * That is also why the category is required and never guessed from the name. A
 * status whose meaning was inferred would be one that quietly changed meaning
 * the day somebody edited its label.
 */

const SELECT = {
    id: true,
    kind: true,
    name: true,
    category: true,
    sort_order: true,
    is_default: true,
    is_active: true,
} as const;

const getAll = async (user: IRequestUser, kind?: WorkflowKind) =>
    prisma.workflowStatus.findMany({
        where: { organization_id: user.organizationId, ...(kind ? { kind } : {}) },
        select: {
            ...SELECT,
            _count: { select: { tasks: true, projects: true } },
        },
        orderBy: [{ kind: "asc" }, { sort_order: "asc" }],
    });

const assertUniqueName = async (
    organizationId: string,
    kind: WorkflowKind,
    name: string,
    exceptId?: string
) => {
    // Case-insensitive: the point of a board column is that "Done" and "done"
    // are one column, not two.
    const duplicate = await prisma.workflowStatus.findFirst({
        where: {
            organization_id: organizationId,
            kind,
            name: { equals: name, mode: "insensitive" },
            ...(exceptId ? { id: { not: exceptId } } : {}),
        },
        select: { name: true },
    });

    if (duplicate) {
        throw new AppError(status.CONFLICT, `"${duplicate.name}" is already on this board`);
    }
};

const create = async (payload: ICreateWorkflowStatusPayload, user: IRequestUser) => {
    const name = payload.name.trim();
    await assertUniqueName(user.organizationId, payload.kind, name);

    return prisma.$transaction(async (tx) => {
        // Appended to the end of the board unless told otherwise. A new column
        // landing in the middle of somebody's workflow is a surprise.
        const last = await tx.workflowStatus.findFirst({
            where: { organization_id: user.organizationId, kind: payload.kind },
            orderBy: { sort_order: "desc" },
            select: { sort_order: true },
        });

        if (payload.is_default) {
            await tx.workflowStatus.updateMany({
                where: { organization_id: user.organizationId, kind: payload.kind },
                data: { is_default: false },
            });
        }

        const created = await tx.workflowStatus.create({
            data: {
                organization_id: user.organizationId,
                kind: payload.kind,
                name,
                category: payload.category,
                sort_order: payload.sort_order ?? (last?.sort_order ?? -1) + 1,
                is_default: payload.is_default ?? false,
            },
            select: SELECT,
        });

        await logActivity(
            tx,
            {
                entityType: "workflow_status",
                entityId: created.id,
                action: "created",
                summary: `Added "${created.name}" to the ${payload.kind} board`,
            },
            user
        );

        return created;
    });
};

const update = async (id: string, payload: IUpdateWorkflowStatusPayload, user: IRequestUser) => {
    const existing = await prisma.workflowStatus.findFirst({
        where: { id, organization_id: user.organizationId },
        select: { id: true, kind: true, name: true, is_default: true },
    });

    if (!existing) {
        throw new AppError(status.NOT_FOUND, "Status not found");
    }

    if (payload.name) {
        await assertUniqueName(user.organizationId, existing.kind, payload.name.trim(), id);
    }

    return prisma.$transaction(async (tx) => {
        // One default per board. Setting a new one clears the old rather than
        // leaving two, which would make "what does a new task start on" a
        // question with two answers.
        if (payload.is_default) {
            await tx.workflowStatus.updateMany({
                where: { organization_id: user.organizationId, kind: existing.kind },
                data: { is_default: false },
            });
        }

        const updated = await tx.workflowStatus.update({
            where: { id },
            data: {
                ...(payload.name !== undefined ? { name: payload.name.trim() } : {}),
                ...(payload.category !== undefined ? { category: payload.category } : {}),
                ...(payload.sort_order !== undefined ? { sort_order: payload.sort_order } : {}),
                ...(payload.is_default !== undefined ? { is_default: payload.is_default } : {}),
                ...(payload.is_active !== undefined ? { is_active: payload.is_active } : {}),
            },
            select: SELECT,
        });

        await logActivity(
            tx,
            {
                entityType: "workflow_status",
                entityId: id,
                action: "updated",
                summary:
                    payload.category !== undefined && payload.category !== undefined
                        ? `Changed what "${updated.name}" means to ${updated.category}`
                        : `Updated "${updated.name}" on the ${existing.kind} board`,
            },
            user
        );

        return updated;
    });
};

const remove = async (id: string, user: IRequestUser) => {
    const existing = await prisma.workflowStatus.findFirst({
        where: { id, organization_id: user.organizationId },
        select: {
            id: true,
            name: true,
            kind: true,
            is_default: true,
            _count: { select: { tasks: true, projects: true } },
        },
    });

    if (!existing) {
        throw new AppError(status.NOT_FOUND, "Status not found");
    }

    const inUse = existing._count.tasks + existing._count.projects;

    // Refused rather than moving the work somewhere. Deleting a column would
    // have to put everything on it into another one, and "another one" is a
    // decision nobody asked to make.
    if (inUse > 0) {
        throw new AppError(
            status.CONFLICT,
            `${inUse} ${existing.kind === WorkflowKind.task ? "tasks are" : "projects are"} on "${existing.name}". Move them first, or turn it off instead of deleting it.`
        );
    }

    // A board with nothing to start on cannot take new work at all.
    const remaining = await prisma.workflowStatus.count({
        where: { organization_id: user.organizationId, kind: existing.kind, id: { not: id } },
    });

    if (remaining === 0) {
        throw new AppError(
            status.CONFLICT,
            "This is the last status on the board. A board with no statuses cannot take new work."
        );
    }

    return prisma.$transaction(async (tx) => {
        await tx.workflowStatus.delete({ where: { id } });

        // Never leave a board without a default: the next thing created would
        // land nowhere.
        if (existing.is_default) {
            const next = await tx.workflowStatus.findFirst({
                where: { organization_id: user.organizationId, kind: existing.kind },
                orderBy: { sort_order: "asc" },
                select: { id: true },
            });

            if (next) {
                await tx.workflowStatus.update({
                    where: { id: next.id },
                    data: { is_default: true },
                });
            }
        }

        await logActivity(
            tx,
            {
                entityType: "workflow_status",
                entityId: id,
                action: "deleted",
                summary: `Removed "${existing.name}" from the ${existing.kind} board`,
            },
            user
        );

        return { message: "Status removed" };
    });
};

export const WorkflowStatusService = { getAll, create, update, remove };
export { StatusCategory, WorkflowKind };
