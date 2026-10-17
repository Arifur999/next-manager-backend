import status from "http-status";
import { Prisma } from "../../../generated/prisma/client.js";
import { WorkflowKind } from "../../../generated/prisma/enums.js";
import AppError from "../../errorHelpers/AppError.js";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import { resolveScope } from "../../shared/resolveScope.js";
import { assertProjectAvailable } from "../../shared/planLimits.js";
import { prisma } from "../../lib/prisma.js";
import { defaultStatusId } from "../../shared/defaultWorkflowStatuses.js";
import { logActivity } from "../../shared/activity.js";
import { escapeLikeTerm, findPage, type ListOptions } from "../../shared/listQuery.js";
import {
    ICreateProjectPayload,
    ISetBaselinePayload,
    IUpdateProjectPayload,
} from "./project.validation.js";
import { toDateOnly } from "../../shared/dates.js";
import { assertOwnClient, assertOwnService, assertOwnStatus } from "../../shared/ownership.js";

/**
 * Projects the caller may see, from the projects view scope. By default
 * operations sees the projects they are a member of - membership, not task
 * assignment, so a quiet week does not hide their project. organization_id
 * always sits above this.
 */
const visibilityScope = async (user: IRequestUser): Promise<Prisma.ProjectWhereInput> => {
    const scope = await resolveScope(user, "projects", "view");

    switch (scope) {
        case "all":
            return {};
        // A project has no owner, so "own" and "assigned" are the same reach
        // here: the people on it. Mapped rather than left to fall through, so
        // an agency that picks "own" gets the sensible answer instead of
        // nothing.
        case "assigned":
        case "own":
            return { members: { some: { user_id: user.userId } } };
        case "none":
        default:
            // Matches no row, and the by-id read below therefore 404s. "None"
            // has to mean none on BOTH paths - a list that hides a project
            // while its id still answers is not a scope, it is a slower search.
            return { id: { in: [] } };
    }
};

const getAllProjects = async (
    user: IRequestUser,
    options: ListOptions = {},
    filters: { statusName?: string; mine?: boolean } = {}
) => {
    const where: Prisma.ProjectWhereInput = {
        organization_id: user.organizationId,
        deleted_at: null,
        ...(await visibilityScope(user)),
        // Matched on NAME, case-insensitively, because a sidebar href is a
        // static string: a status id differs per agency so it cannot appear in
        // one, and category cannot tell Active from Review - both are
        // `active`. An agency that renames a column sees an empty view for it
        // until the entry is renamed too, which is the same trade the Clients
        // sub-views already make.
        ...(filters.statusName
            ? { status: { name: { equals: filters.statusName, mode: "insensitive" } } }
            : {}),
        // Projects this person is actually on, whatever their role. Not the
        // same as the operations visibility scope above, which is a rule rather
        // than a choice - this one is asked for.
        ...(filters.mine ? { members: { some: { user_id: user.userId } } } : {}),
        ...(options.search
            ? {
                OR: [
                    { name: { contains: escapeLikeTerm(options.search), mode: "insensitive" } },
                    { code: { contains: escapeLikeTerm(options.search), mode: "insensitive" } },
                    { client: { name: { contains: escapeLikeTerm(options.search), mode: "insensitive" } } },
                ],
            }
            : {}),
    };

    const include = {
        // Carried on every row: a list that had to fetch the board to render
        // a column name would be one more query and one more chance for the two
        // to disagree.
        status: { select: { id: true, name: true, category: true, sort_order: true } },
        client: { select: { id: true, name: true, company: true } },
        _count: { select: { tasks: true, members: true } },
    };

    const { rows, total } = await findPage(
        options,
        (page) => prisma.project.findMany({ where, include, orderBy: { created_at: "desc" }, ...page }),
        () => prisma.project.count({ where })
    );

    return { rows, total };
};

const getSingleProject = async (id: string, user: IRequestUser) => {
    const project = await prisma.project.findFirst({
        // Scoped in the WHERE rather than checked after: a project they are not
        // on reads as "not found", and which projects exist is not information
        // to hand out.
        where: {
            id,
            organization_id: user.organizationId,
            deleted_at: null,
            ...(await visibilityScope(user)),
        },
        include: {
            status: { select: { id: true, name: true, category: true, sort_order: true } },
            client: { select: { id: true, name: true, company: true, email: true } },
            members: {
                include: { user: { select: { id: true, full_name: true, email: true, avatar_url: true, role: true } } },
            },
            tasks: {
                where: { deleted_at: null },
                include: {
                    assignee: { select: { id: true, full_name: true, avatar_url: true } },
                    status: { select: { id: true, name: true, category: true, sort_order: true } },
                },
                orderBy: [{ status: { sort_order: "asc" } }, { due_date: "asc" }],
            },
        },
    });

    if (!project) {
        throw new AppError(status.NOT_FOUND, "Project not found");
    }

    return project;
};

const createProject = async (payload: ICreateProjectPayload, user: IRequestUser) => {
    // The project count and the insert share one transaction, under a lock.
    return prisma.$transaction(async (tx) => {
        await assertOwnClient(tx, payload.client_id, user.organizationId);
        await assertProjectAvailable(tx, user.organizationId);

        const duplicate = await tx.project.findFirst({
            where: { organization_id: user.organizationId, code: payload.code },
            select: { id: true },
        });

        if (duplicate) {
            throw new AppError(status.CONFLICT, "A project with this code already exists");
        }

        await assertOwnService(tx, payload.service_id, user.organizationId);

        if (payload.status_id) {
            await assertOwnStatus(tx, payload.status_id, user.organizationId, WorkflowKind.project);
        }

        // Chosen, or whatever the board starts on. An agency always has statuses
        // - they are seeded with the organization - so a missing one means every
        // status was switched off, and saying that is more use than a foreign key
        // error.
        const statusId =
            payload.status_id ?? (await defaultStatusId(tx, user.organizationId, WorkflowKind.project));

        if (!statusId) {
            throw new AppError(
                status.BAD_REQUEST,
                "This board has no statuses turned on. Add one before creating a project."
            );
        }

        return tx.project.create({
            data: {
                organization_id: user.organizationId,
                client_id: payload.client_id,
                service_id: payload.service_id ?? null,
                name: payload.name,
                code: payload.code,
                description: payload.description ?? "",
                status_id: statusId,
                start_date: payload.start_date ? toDateOnly(payload.start_date) : null,
                end_date: payload.end_date ? toDateOnly(payload.end_date) : null,
                contract_value_usd: payload.contract_value_usd ?? 0,
                notes: payload.notes ?? "",
            },
            include: {
                client: { select: { id: true, name: true } },
                status: { select: { id: true, name: true, category: true, sort_order: true } },
            },
        });
    });
};

const toOptionalDate = (value: string | null | undefined) =>
    value === undefined || value === null ? value : toDateOnly(value);

const updateProject = async (id: string, payload: IUpdateProjectPayload, user: IRequestUser) => {
    const existing = await prisma.project.findFirst({
        where: { id, organization_id: user.organizationId, deleted_at: null },
    });

    if (!existing) {
        throw new AppError(status.NOT_FOUND, "Project not found");
    }

    await assertOwnClient(prisma, payload.client_id, user.organizationId);
    await assertOwnService(prisma, payload.service_id, user.organizationId);

    if (payload.status_id) {
        await assertOwnStatus(prisma, payload.status_id, user.organizationId, WorkflowKind.project);
    }

    return prisma.project.update({
        where: { id },
        data: {
            ...payload,
            // undefined leaves a date alone, null clears it, a string sets it.
            start_date: toOptionalDate(payload.start_date),
            end_date: toOptionalDate(payload.end_date),
        },
        include: {
            client: { select: { id: true, name: true } },
            status: { select: { id: true, name: true, category: true, sort_order: true } },
        },
    });
};

/**
 * Freeze the plan a project is measured against: plan-vs-actual and scope
 * change need an original that does not move. Re-baselining must be asked for
 * explicitly, or any project could be made to read as on plan.
 */
const setBaseline = async (id: string, payload: ISetBaselinePayload, user: IRequestUser) => {
    const existing = await prisma.project.findFirst({
        where: { id, organization_id: user.organizationId, deleted_at: null },
        select: { id: true, baseline_set_at: true, contract_value_usd: true },
    });

    if (!existing) {
        throw new AppError(status.NOT_FOUND, "Project not found");
    }

    if (existing.baseline_set_at && !payload.replace_existing) {
        throw new AppError(
            status.CONFLICT,
            "This project is already baselined. Replacing it discards the original every overrun is measured against."
        );
    }

    return prisma.project.update({
        where: { id },
        data: {
            baseline_hours: payload.baseline_hours,
            baseline_value_usd: payload.baseline_value_usd ?? existing.contract_value_usd,
            baseline_set_at: new Date(),
        },
        include: {
            client: { select: { id: true, name: true } },
            status: { select: { id: true, name: true, category: true, sort_order: true } },
        },
    });
};

const deleteProject = async (id: string, user: IRequestUser) => {
    const existing = await prisma.project.findFirst({
        where: { id, organization_id: user.organizationId, deleted_at: null },
    });

    if (!existing) {
        throw new AppError(status.NOT_FOUND, "Project not found");
    }

    // Payments and expenses point at a project with SetNull, so deleting one
    // would silently detach its financial history and quietly change every
    // profitability figure that included it.
    const [paymentCount, expenseCount] = await Promise.all([
        prisma.payment.count({ where: { project_id: id, organization_id: user.organizationId, deleted_at: null } }),
        prisma.expense.count({ where: { project_id: id, organization_id: user.organizationId, deleted_at: null } }),
    ]);

    if (paymentCount > 0 || expenseCount > 0) {
        throw new AppError(
            status.CONFLICT,
            "This project has financial records against it. Mark it cancelled or completed instead."
        );
    }

    await prisma.$transaction(async (tx) => {
        await tx.project.update({
            where: { id },
            data: { deleted_at: new Date(), deleted_by: user.userId },
        });

        await logActivity(
            tx,
            {
                entityType: "project",
                entityId: id,
                action: "deleted",
                summary: `Deleted the project ${existing.name} (${existing.code})`,
            },
            user
        );
    });

    return { message: "Project deleted successfully" };
};

export const ProjectService = {
    getAllProjects,
    getSingleProject,
    createProject,
    updateProject,
    setBaseline,
    deleteProject,
};
