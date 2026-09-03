import status from "http-status";
import { Prisma } from "../../../generated/prisma/client.js";
import { InvoiceStatus, Role, WorkflowKind } from "../../../generated/prisma/enums.js";
import AppError from "../../errorHelpers/AppError.js";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import { assertProjectAvailable } from "../../middleware/checkSubscription.js";
import { prisma } from "../../lib/prisma.js";
import { assertOwnService } from "../../shared/assertOwnService.js";
import { defaultStatusId } from "../../shared/defaultWorkflowStatuses.js";
import { logActivity } from "../../shared/activity.js";
import { escapeLikeTerm, pageSlice, type ListOptions } from "../../shared/listQuery.js";
import {
    ICreateProjectPayload,
    ISetBaselinePayload,
    IUpdateProjectPayload,
} from "./project.validation.js";

/**
 * Projects the caller may see.
 *
 * Operations sees only the ones they are on. The same shape tasks already use,
 * and it was missing here: an agency's whole project list, with client names
 * and contract values attached, was readable by anyone with a login.
 *
 * Membership, not assignment - a person on the team of a project should see
 * the project even on a week they have no task open on it.
 */
const visibilityScope = (user: IRequestUser): Prisma.ProjectWhereInput =>
    user.role === Role.operations
        ? { members: { some: { user_id: user.userId } } }
        : {};

const getAllProjects = async (
    user: IRequestUser,
    options: ListOptions = {},
    filters: { statusName?: string; mine?: boolean } = {}
) => {
    const where: Prisma.ProjectWhereInput = {
        organization_id: user.organizationId,
        deleted_at: null,
        ...visibilityScope(user),
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

    const slice = pageSlice(options);

    if (!slice) {
        const rows = await prisma.project.findMany({ where, include, orderBy: { created_at: "desc" } });
        return { rows, total: rows.length };
    }

    const [rows, total] = await Promise.all([
        prisma.project.findMany({
            where,
            include,
            orderBy: { created_at: "desc" },
            skip: slice.skip,
            take: slice.take,
        }),
        prisma.project.count({ where }),
    ]);

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
            ...visibilityScope(user),
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

/**
 * The Finance tab on a project.
 *
 * Profit is deliberately computed in BDT, not USD, because that is the only
 * currency in which both sides of it exist: income arrives in USD, but team
 * payouts and expenses are BDT and have no USD figure at all. Mixing them would
 * require converting costs at some rate chosen after the fact.
 *
 * The income side therefore uses each payment's FROZEN reporting rate - the one
 * saved with the payment - rather than reconverting at today's rate. That keeps
 * a finished project's profit from drifting every time the taka moves.
 */
const getProjectFinancials = async (id: string, user: IRequestUser) => {
    const project = await prisma.project.findFirst({
        where: { id, organization_id: user.organizationId, deleted_at: null },
        select: { id: true, contract_value_usd: true },
    });

    if (!project) {
        throw new AppError(status.NOT_FOUND, "Project not found");
    }

    const scope = { project_id: id, organization_id: user.organizationId, deleted_at: null };

    const [received, invoiced, payouts, expenses] = await Promise.all([
        prisma.payment.aggregate({
            where: scope,
            _sum: { amount_usd: true, amount_bdt_reporting: true },
        }),
        prisma.invoice.aggregate({
            where: {
                project_id: id,
                organization_id: user.organizationId,
                deleted_at: null,
                status: { notIn: [InvoiceStatus.draft, InvoiceStatus.cancelled] },
            },
            _sum: { total: true },
        }),
        prisma.teamPayout.aggregate({ where: scope, _sum: { amount_bdt: true } }),
        prisma.expense.aggregate({ where: scope, _sum: { amount_bdt: true } }),
    ]);

    const receivedUsd = received._sum.amount_usd?.toNumber() ?? 0;
    const receivedBdt = received._sum.amount_bdt_reporting?.toNumber() ?? 0;
    const invoicedUsd = invoiced._sum.total?.toNumber() ?? 0;
    const teamCostBdt = payouts._sum.amount_bdt?.toNumber() ?? 0;
    const expenseBdt = expenses._sum.amount_bdt?.toNumber() ?? 0;

    return {
        contract_value_usd: project.contract_value_usd.toNumber(),
        invoiced_usd: invoicedUsd,
        received_usd: receivedUsd,
        // Never negative: an overpayment is a credit to deal with elsewhere,
        // not a negative receivable that would offset another project.
        outstanding_usd: Math.max(invoicedUsd - receivedUsd, 0),
        received_bdt: receivedBdt,
        team_cost_bdt: teamCostBdt,
        expense_bdt: expenseBdt,
        total_cost_bdt: teamCostBdt + expenseBdt,
        // Money actually received, minus money actually spent. Not "contract
        // value minus cost" - unpaid work is not profit.
        profit_bdt: receivedBdt - teamCostBdt - expenseBdt,
    };
};

const createProject = async (payload: ICreateProjectPayload, user: IRequestUser) => {
    const client = await prisma.client.findFirst({
        where: { id: payload.client_id, organization_id: user.organizationId, deleted_at: null },
        select: { id: true },
    });

    if (!client) {
        throw new AppError(status.NOT_FOUND, "Client not found");
    }

    await assertProjectAvailable(user.organizationId);

    const duplicate = await prisma.project.findFirst({
        where: { organization_id: user.organizationId, code: payload.code },
        select: { id: true },
    });

    if (duplicate) {
        throw new AppError(status.CONFLICT, "A project with this code already exists");
    }

    await assertOwnService(prisma, payload.service_id, user);

    // Chosen, or whatever the board starts on. An agency always has statuses
    // - they are seeded with the organization - so a missing one means every
    // status was switched off, and saying that is more use than a foreign key
    // error.
    const statusId =
        payload.status_id ?? (await defaultStatusId(prisma, user.organizationId, WorkflowKind.project));

    if (!statusId) {
        throw new AppError(
            status.BAD_REQUEST,
            "This board has no statuses turned on. Add one before creating a project."
        );
    }

    return prisma.project.create({
        data: {
            organization_id: user.organizationId,
            client_id: payload.client_id,
            service_id: payload.service_id ?? null,
            name: payload.name,
            code: payload.code,
            description: payload.description ?? "",
            status_id: statusId,
            start_date: payload.start_date ? new Date(`${payload.start_date}T00:00:00.000Z`) : null,
            end_date: payload.end_date ? new Date(`${payload.end_date}T00:00:00.000Z`) : null,
            contract_value_usd: payload.contract_value_usd ?? 0,
            notes: payload.notes ?? "",
        },
        include: {
            client: { select: { id: true, name: true } },
            status: { select: { id: true, name: true, category: true, sort_order: true } },
        },
    });
};

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

    await assertOwnService(prisma, payload.service_id, user);

    return prisma.project.update({
        where: { id },
        data: {
            ...payload,
            start_date: payload.start_date ? new Date(`${payload.start_date}T00:00:00.000Z`) : undefined,
            end_date: payload.end_date ? new Date(`${payload.end_date}T00:00:00.000Z`) : undefined,
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
    getProjectFinancials,
    createProject,
    updateProject,
    setBaseline,
    deleteProject,
};
