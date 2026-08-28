import status from "http-status";
import { Prisma } from "../../../generated/prisma/client.js";
import { Role, TaskStatus } from "../../../generated/prisma/enums.js";
import AppError from "../../errorHelpers/AppError.js";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import { prisma } from "../../lib/prisma.js";
import { escapeLikeTerm, pageSlice, type ListOptions } from "../../shared/listQuery.js";
import { ICreateTaskPayload, IUpdateTaskPayload } from "./task.validation.js";

const toDate = (value: string) => new Date(`${value}T00:00:00.000Z`);

const INCLUDE = {
    project: { select: { id: true, name: true, code: true } },
    assignee: { select: { id: true, full_name: true, email: true, avatar_url: true } },
} as const;

const assertReferences = async (
    tx: Prisma.TransactionClient,
    payload: { project_id?: string; assignee_id?: string | null },
    user: IRequestUser
) => {
    if (payload.project_id) {
        const project = await tx.project.findFirst({
            where: { id: payload.project_id, organization_id: user.organizationId, deleted_at: null },
            select: { id: true },
        });
        if (!project) throw new AppError(status.NOT_FOUND, "Project not found");
    }

    if (payload.assignee_id) {
        const assignee = await tx.user.findFirst({
            where: { id: payload.assignee_id, organization_id: user.organizationId, deleted_at: null },
            select: { id: true },
        });
        if (!assignee) throw new AppError(status.NOT_FOUND, "Assignee not found");
    }
};

/**
 * Tasks the caller is allowed to see.
 *
 * Operations sees only what is assigned to them. Anyone above that sees the whole
 * agency's board - which is the difference between "My Tasks" and the project
 * task list being the same endpoint with a different scope, rather than two
 * near-identical ones that drift apart.
 */
const visibilityScope = (user: IRequestUser): Prisma.TaskWhereInput =>
    user.role === Role.operations ? { assignee_id: user.userId } : {};

const getAllTasks = async (
    user: IRequestUser,
    filters: { projectId?: string; assigneeId?: string; status?: TaskStatus; mine?: boolean },
    options: ListOptions = {}
) => {
    const where: Prisma.TaskWhereInput = {
        organization_id: user.organizationId,
        deleted_at: null,
        ...visibilityScope(user),
        ...(filters.mine ? { assignee_id: user.userId } : {}),
        ...(filters.projectId ? { project_id: filters.projectId } : {}),
        ...(filters.assigneeId ? { assignee_id: filters.assigneeId } : {}),
        ...(filters.status ? { status: filters.status } : {}),
        ...(options.search
            ? { title: { contains: escapeLikeTerm(options.search), mode: "insensitive" } }
            : {}),
    };

    // Unfinished first, then by due date. A board sorted by creation date is a
    // board nobody looks at twice.
    const orderBy: Prisma.TaskOrderByWithRelationInput[] = [
        { status: "asc" },
        { due_date: { sort: "asc", nulls: "last" } },
        { priority: "desc" },
    ];

    const slice = pageSlice(options);

    if (!slice) {
        const rows = await prisma.task.findMany({ where, include: INCLUDE, orderBy });
        return { rows, total: rows.length };
    }

    const [rows, total] = await Promise.all([
        prisma.task.findMany({ where, include: INCLUDE, orderBy, skip: slice.skip, take: slice.take }),
        prisma.task.count({ where }),
    ]);

    return { rows, total };
};

const createTask = async (payload: ICreateTaskPayload, user: IRequestUser) => {
    return prisma.$transaction(async (tx) => {
        await assertReferences(tx, payload, user);

        return tx.task.create({
            data: {
                organization_id: user.organizationId,
                project_id: payload.project_id,
                title: payload.title,
                description: payload.description ?? "",
                assignee_id: payload.assignee_id ?? null,
                status: payload.status,
                priority: payload.priority,
                due_date: payload.due_date ? toDate(payload.due_date) : null,
                created_by: user.userId,
            },
            include: INCLUDE,
        });
    });
};

const updateTask = async (id: string, payload: IUpdateTaskPayload, user: IRequestUser) => {
    return prisma.$transaction(async (tx) => {
        const existing = await tx.task.findFirst({
            where: {
                id,
                organization_id: user.organizationId,
                deleted_at: null,
                ...visibilityScope(user),
            },
        });

        if (!existing) {
            throw new AppError(status.NOT_FOUND, "Task not found");
        }

        await assertReferences(tx, payload, user);

        // completed_at is derived from status rather than accepted from the
        // client: it is the one field that has to agree with the status, and
        // letting both be set independently guarantees they eventually will not.
        const movingToDone = payload.status === TaskStatus.done && existing.status !== TaskStatus.done;
        const movingOffDone = payload.status && payload.status !== TaskStatus.done && existing.status === TaskStatus.done;

        return tx.task.update({
            where: { id },
            data: {
                project_id: payload.project_id ?? undefined,
                title: payload.title ?? undefined,
                description: payload.description ?? undefined,
                assignee_id: payload.assignee_id === undefined ? undefined : payload.assignee_id,
                status: payload.status ?? undefined,
                priority: payload.priority ?? undefined,
                due_date: payload.due_date === undefined ? undefined : payload.due_date ? toDate(payload.due_date) : null,
                completed_at: movingToDone ? new Date() : movingOffDone ? null : undefined,
            },
            include: INCLUDE,
        });
    });
};

const deleteTask = async (id: string, user: IRequestUser) => {
    const existing = await prisma.task.findFirst({
        where: { id, organization_id: user.organizationId, deleted_at: null },
    });

    if (!existing) {
        throw new AppError(status.NOT_FOUND, "Task not found");
    }

    await prisma.task.update({
        where: { id },
        data: { deleted_at: new Date() },
    });

    return { message: "Task deleted successfully" };
};

export const TaskService = {
    getAllTasks,
    createTask,
    updateTask,
    deleteTask,
};
