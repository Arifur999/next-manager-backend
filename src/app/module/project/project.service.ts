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
import { assertOwnService, assertOwnStatus } from "../../shared/ownership.js";

/**
 * Projects the caller may see.
 *
 * Operations sees only the ones they are on. The same shape tasks already use,
 * and it was missing here: an agency's whole project list, with client names
 * and contract values attached, was readable by anyone with a login.
 *
 * Membership, not assignment - a person on the team of a project should see
 * the project even on a week they have no task open on it.
 *
 * Read from the permission rows now rather than from `role === operations`.
 * The behaviour is identical for every stock agency, because that is exactly
 * what the seed says; what changed is that an agency can now say something
 * else. What it can NEVER say is another agency: organization_id sits above
 * this in the same where clause and no scope removes it.
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
    const client = await prisma.client.findFirst({
        where: { id: payload.client_id, organization_id: user.organizationId, deleted_at: null },
        select: { id: true },
    });

    if (!client) {
        throw new AppError(status.NOT_FOUND, "Client not found");
    }

    // The project count and the insert share one transaction, under a lock.
    return prisma.$transaction(async (tx) => {
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

    if (payload.client_id) {
        const client = await prisma.client.findFirst({
            where: { id: payload.client_id, organization_id: user.organizationId, deleted_at: null },
            select: { id: true },
        });
        if (!client) throw new AppError(status.NOT_FOUND, "Client not found");
    }

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
 * Freeze the plan a project will be measured against.
 *
 * Plan-vs-actual and scope-change rate both need an original that does not
 * move. The contract value does move - that is what makes drift measurable -
 * so the baseline is copied once and then left alone.
 *
 * Re-baselining is allowed but never implicit: it throws away the number every
 * overrun was being measured from, and a project quietly re-baselined at its
 * current state always reads as perfectly on plan.
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
