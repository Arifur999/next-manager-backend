import status from "http-status";
import { Prisma } from "../../../generated/prisma/client.js";
import {
    NotificationEvent,
    StatusCategory,
    WorkflowKind,
} from "../../../generated/prisma/enums.js";
import AppError from "../../errorHelpers/AppError.js";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import { resolveScope } from "../../shared/resolveScope.js";
import { prisma } from "../../lib/prisma.js";
import { logActivity } from "../../shared/activity.js";
import { defaultStatusId } from "../../shared/defaultWorkflowStatuses.js";
import { notify } from "../../shared/notify.js";
import {
    dateRangeWhere,
    escapeLikeTerm,
    pageSlice,
    type ListOptions,
} from "../../shared/listQuery.js";
import { ICreateTaskPayload, IUpdateTaskPayload } from "./task.validation.js";

const toDate = (value: string) => new Date(`${value}T00:00:00.000Z`);

const INCLUDE = {
    project: { select: { id: true, name: true, code: true } },
    assignee: { select: { id: true, full_name: true, email: true, avatar_url: true } },
    // Carried on every row rather than looked up by the client: a board that
    // fetched the status list to render a column name would be one more query
    // and one more chance for the two to disagree.
    status: { select: { id: true, name: true, category: true, sort_order: true } },
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
const visibilityScope = async (user: IRequestUser): Promise<Prisma.TaskWhereInput> => {
    const scope = await resolveScope(user, "tasks", "view");

    switch (scope) {
        case "all":
            return {};
        // A task is assigned to exactly one person, so both narrowing scopes
        // mean the same thing: yours. Kept apart in the catalogue because
        // clients and projects distinguish them, and one vocabulary across
        // twelve modules is worth more than a special case here.
        case "assigned":
        case "own":
            return { assignee_id: user.userId };
        case "none":
        default:
            // Nothing in the list, and 404 by id on the reads below.
            return { id: { in: [] } };
    }
};

/** Midnight today, UTC. due_date is a date column, so the comparison has to
 *  be a day boundary - comparing it to `now` would call a task due today
 *  overdue from one second past midnight. */
const startOfToday = () => {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
};

/** Seven days out, inclusive. The far edge of "upcoming". */
const endOfUpcoming = () => {
    const today = startOfToday();
    return new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
};

const getAllTasks = async (
    user: IRequestUser,
    filters: {
        projectId?: string;
        assigneeId?: string;
        statusId?: string;
        statusName?: string;
        mine?: boolean;
        clientOwnerMine?: boolean;
        overdue?: boolean;
        due?: "today" | "upcoming";
        completed?: boolean;
    },
    options: ListOptions = {}
) => {
    const where: Prisma.TaskWhereInput = {
        organization_id: user.organizationId,
        deleted_at: null,
        ...(await visibilityScope(user)),
        ...(filters.mine ? { assignee_id: user.userId } : {}),
        // Not "tasks assigned to me" but "tasks inside work I brought in" -
        // a salesperson watching their own client without touching it.
        ...(filters.clientOwnerMine
            ? { project: { client: { owner_id: user.userId } } }
            : {}),
        ...(filters.projectId ? { project_id: filters.projectId } : {}),
        ...(filters.assigneeId ? { assignee_id: filters.assigneeId } : {}),
        ...(filters.statusId ? { status_id: filters.statusId } : {}),
        // By name, for the same reason projects are: a sidebar entry cannot
        // carry an id that differs per agency.
        ...(filters.statusName
            ? { status: { name: { equals: filters.statusName, mode: "insensitive" } } }
            : {}),
        // Due today, and due soon. Compared on the DAY boundary through the
        // same startOfToday() overdue uses: due_date is a date column, and
        // comparing it against `now` would call a task due today overdue from
        // one second past midnight.
        //
        // "Upcoming" is a seven-day window rather than everything with a future
        // date, so the list stays a week of work instead of a backlog.
        ...(filters.due === "today" ? { due_date: startOfToday() } : {}),
        ...(filters.due === "upcoming"
            ? { due_date: { gt: startOfToday(), lte: endOfUpcoming() } }
            : {}),
        // Finished, read by CATEGORY rather than by a status name - an agency
        // that renames Done to Shipped keeps a working view. Cancelled is not
        // finished work, so it is not on this list either.
        ...(filters.completed ? { status: { category: StatusCategory.done } } : {}),
        // Overdue means past its date AND not finished. A task delivered
        // late is not still overdue - it is done, and putting it on this
        // list would make a screen of things to chase that cannot shrink.
        ...(filters.overdue
            ? {
                due_date: { lt: startOfToday() },
                status: { category: { notIn: [StatusCategory.done, StatusCategory.cancelled] } },
            }
            : {}),
        ...(options.search
            ? { title: { contains: escapeLikeTerm(options.search), mode: "insensitive" } }
            : {}),
    };

    // Unfinished first, then by due date. A board sorted by creation date is a
    // board nobody looks at twice.
    const orderBy: Prisma.TaskOrderByWithRelationInput[] = [
        // Board order, which is a sequence the agency chose - not alphabetical.
        { status: { sort_order: "asc" } },
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

        // Chosen, or whatever the board starts on. An agency always has
        // statuses - they are seeded with the organization - so a missing one
        // means somebody switched every single status off, and saying that is
        // more use than a foreign key error.
        const statusId =
            payload.status_id ?? (await defaultStatusId(tx, user.organizationId, WorkflowKind.task));

        if (!statusId) {
            throw new AppError(
                status.BAD_REQUEST,
                "This board has no statuses turned on. Add one before creating work."
            );
        }

        const task = await tx.task.create({
            data: {
                organization_id: user.organizationId,
                project_id: payload.project_id,
                title: payload.title,
                description: payload.description ?? "",
                assignee_id: payload.assignee_id ?? null,
                status_id: statusId,
                priority: payload.priority,
                due_date: payload.due_date ? toDate(payload.due_date) : null,
                created_by: user.userId,
            },
            include: INCLUDE,
        });

        if (task.assignee_id) {
            await notify(tx, user, {
                event: NotificationEvent.task_assigned,
                userId: task.assignee_id,
                title: `You were given "${task.title}"`,
                body: task.due_date
                    ? `Due ${task.due_date.toISOString().slice(0, 10)}`
                    : "No due date set",
                entityType: "task",
                entityId: task.id,
            });
        }

        return task;
    });
};

const updateTask = async (id: string, payload: IUpdateTaskPayload, user: IRequestUser) => {
    return prisma.$transaction(async (tx) => {
        const existing = await tx.task.findFirst({
            where: {
                id,
                organization_id: user.organizationId,
                deleted_at: null,
                ...(await visibilityScope(user)),
            },
            // The category comes with it, because that is what decides
            // whether completed_at moves.
            include: { status: { select: { category: true } } },
        });

        if (!existing) {
            throw new AppError(status.NOT_FOUND, "Task not found");
        }

        await assertReferences(tx, payload, user);

        // completed_at is derived from the status rather than accepted from
        // the client: it is the one field that has to agree with the status,
        // and letting both be set independently guarantees they eventually
        // will not.
        //
        // Compared by CATEGORY, never by name. An agency that renames "Done"
        // to "Shipped" or adds "Client approved" alongside it keeps a working
        // completion date; comparing names would silently stop the clock.
        const nextStatus = payload.status_id
            ? await tx.workflowStatus.findFirst({
                  where: {
                      id: payload.status_id,
                      organization_id: user.organizationId,
                      kind: WorkflowKind.task,
                  },
                  select: { id: true, category: true },
              })
            : null;

        if (payload.status_id && !nextStatus) {
            throw new AppError(status.NOT_FOUND, "That status does not exist on this board");
        }

        const wasDone = existing.status.category === StatusCategory.done;
        const isDone = nextStatus ? nextStatus.category === StatusCategory.done : wasDone;
        const movingToDone = !wasDone && isDone;
        const movingOffDone = wasDone && !isDone;

        return tx.task.update({
            where: { id },
            data: {
                project_id: payload.project_id ?? undefined,
                title: payload.title ?? undefined,
                description: payload.description ?? undefined,
                assignee_id: payload.assignee_id === undefined ? undefined : payload.assignee_id,
                status_id: payload.status_id ?? undefined,
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

    await prisma.$transaction(async (tx) => {
        await tx.task.update({
            where: { id },
            data: { deleted_at: new Date() },
        });

        // The title is copied into the summary rather than joined to later:
        // the row is soft-deleted and every read filters it out, so a join
        // would render this entry blank.
        await logActivity(
            tx,
            {
                entityType: "task",
                entityId: id,
                action: "deleted",
                summary: `Deleted the task "${existing.title}"`,
            },
            user
        );
    });

    return { message: "Task deleted successfully" };
};

/**
 * The task board, counted.
 *
 * Every figure here already exists on the board; none of them has ever been
 * added up. Which is the point - a project manager asking "where is everything"
 * should not have to count four columns by eye.
 *
 * Read through the same visibilityScope the board uses, so a report never shows
 * somebody work they could not open.
 *
 * "Done" and "overdue" are decided by CATEGORY, never by a status name. An
 * agency that renames Done to Shipped keeps a correct report, and one that adds
 * "In QA" gets it counted as in-flight without telling this function about it.
 */
const getReport = async (user: IRequestUser, options: ListOptions = {}) => {
    const where: Prisma.TaskWhereInput = {
        organization_id: user.organizationId,
        deleted_at: null,
        ...(await visibilityScope(user)),
        ...dateRangeWhere(options, "created_at"),
    };

    const [byStatus, tasks] = await Promise.all([
        prisma.task.groupBy({ by: ["status_id"], where, _count: { _all: true } }),
        prisma.task.findMany({
            where,
            select: {
                id: true,
                due_date: true,
                completed_at: true,
                status: { select: { id: true, name: true, category: true, sort_order: true } },
                assignee: { select: { id: true, full_name: true, avatar_url: true, role: true } },
            },
        }),
    ]);

    const statusById = new Map(
        tasks.filter((task) => task.status).map((task) => [task.status.id, task.status])
    );

    const today = startOfToday();
    const isOpen = (category: StatusCategory) =>
        category !== StatusCategory.done && category !== StatusCategory.cancelled;

    // Late means past its date AND unfinished. A task delivered late is done,
    // and counting it here would make a number to chase that cannot shrink.
    const overdue = tasks.filter(
        (task) => task.due_date && task.status && isOpen(task.status.category) && task.due_date < today
    );

    const perAssignee = new Map<
        string,
        { user: (typeof tasks)[number]["assignee"]; total: number; done: number; overdue: number }
    >();

    for (const task of tasks) {
        // Unassigned work is its own row rather than dropped: "nobody is doing
        // eleven of these" is the most useful line on the page.
        const key = task.assignee?.id ?? "unassigned";
        const entry = perAssignee.get(key) ?? { user: task.assignee, total: 0, done: 0, overdue: 0 };

        entry.total += 1;
        if (task.status && !isOpen(task.status.category)) entry.done += 1;
        if (task.due_date && task.status && isOpen(task.status.category) && task.due_date < today) {
            entry.overdue += 1;
        }

        perAssignee.set(key, entry);
    }

    return {
        total: tasks.length,
        overdue_count: overdue.length,
        done_count: tasks.filter((task) => task.status && !isOpen(task.status.category)).length,
        unassigned_count: tasks.filter((task) => !task.assignee).length,
        by_status: byStatus
            .map((row) => ({
                status: statusById.get(row.status_id) ?? null,
                count: row._count._all,
            }))
            .sort((a, b) => (a.status?.sort_order ?? 0) - (b.status?.sort_order ?? 0)),
        by_assignee: [...perAssignee.values()].sort((a, b) => b.total - a.total),
    };
};

export const TaskService = {
    getReport,
    getAllTasks,
    createTask,
    updateTask,
    deleteTask,
};
