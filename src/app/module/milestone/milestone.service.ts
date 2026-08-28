import status from "http-status";
import { Prisma } from "../../../generated/prisma/client.js";
import AppError from "../../errorHelpers/AppError.js";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import { prisma } from "../../lib/prisma.js";
import { pageSlice, type ListOptions } from "../../shared/listQuery.js";
import {
    IAcceptMilestonePayload,
    ICreateMilestonePayload,
    ISubmitMilestonePayload,
    IUpdateMilestonePayload,
} from "./milestone.validation.js";

/**
 * Dated promises inside a project.
 *
 * On-time delivery is counted over milestones rather than over projects. A
 * project whose final date lands on time after every interim date slipped is
 * not on time in any sense the client recognises, and a single end_date cannot
 * express the difference.
 *
 * Two dates, deliberately kept apart:
 *
 *   - `submitted_at` is when the work was handed over. This is the one
 *     on-time rate is measured against, because it is the only part the team
 *     controls.
 *   - `accepted_at` is when it was signed off. A milestone submitted on time
 *     and never accepted is delivered but not done, and reporting it as a
 *     clean delivery would hide the thing worth noticing.
 */

const INCLUDE = {
    project: { select: { id: true, name: true, code: true } },
} as const;

const toDate = (value: string) => new Date(`${value}T00:00:00.000Z`);

const findOwned = async (id: string, user: IRequestUser) => {
    const milestone = await prisma.projectMilestone.findFirst({
        where: { id, organization_id: user.organizationId, deleted_at: null },
    });

    if (!milestone) {
        throw new AppError(status.NOT_FOUND, "Milestone not found");
    }

    return milestone;
};

const assertProject = async (projectId: string, user: IRequestUser) => {
    const project = await prisma.project.findFirst({
        where: { id: projectId, organization_id: user.organizationId, deleted_at: null },
        select: { id: true },
    });

    if (!project) {
        throw new AppError(status.NOT_FOUND, "Project not found");
    }
};

const getAllMilestones = async (
    user: IRequestUser,
    filters: { projectId?: string; outstanding?: boolean },
    options: ListOptions = {}
) => {
    const where: Prisma.ProjectMilestoneWhereInput = {
        organization_id: user.organizationId,
        deleted_at: null,
        ...(filters.projectId ? { project_id: filters.projectId } : {}),
        ...(filters.outstanding === true ? { submitted_at: null } : {}),
        ...(filters.outstanding === false ? { submitted_at: { not: null } } : {}),
    };

    // Soonest due first: the list is read to find what is about to slip.
    const orderBy: Prisma.ProjectMilestoneOrderByWithRelationInput[] = [
        { due_date: "asc" },
        { sort_order: "asc" },
    ];

    const slice = pageSlice(options);

    if (!slice) {
        const rows = await prisma.projectMilestone.findMany({ where, include: INCLUDE, orderBy });
        return { rows, total: rows.length };
    }

    const [rows, total] = await Promise.all([
        prisma.projectMilestone.findMany({
            where,
            include: INCLUDE,
            orderBy,
            skip: slice.skip,
            take: slice.take,
        }),
        prisma.projectMilestone.count({ where }),
    ]);

    return { rows, total };
};

const createMilestone = async (payload: ICreateMilestonePayload, user: IRequestUser) => {
    await assertProject(payload.project_id, user);

    return prisma.projectMilestone.create({
        data: {
            organization_id: user.organizationId,
            project_id: payload.project_id,
            title: payload.title,
            description: payload.description ?? "",
            due_date: toDate(payload.due_date),
            sort_order: payload.sort_order ?? 0,
            created_by: user.userId,
        },
        include: INCLUDE,
    });
};

const updateMilestone = async (
    id: string,
    payload: IUpdateMilestonePayload,
    user: IRequestUser
) => {
    const existing = await findOwned(id, user);

    // Moving the date after delivery would let a missed milestone be made
    // on-time retroactively, which is exactly the number this table exists to
    // protect. Correcting a genuine mistake means reopening it first.
    if (existing.submitted_at && payload.due_date) {
        throw new AppError(
            status.BAD_REQUEST,
            "This milestone has been submitted. Reopen it before changing the due date."
        );
    }

    return prisma.projectMilestone.update({
        where: { id },
        data: {
            ...(payload.title !== undefined ? { title: payload.title } : {}),
            ...(payload.description !== undefined ? { description: payload.description } : {}),
            ...(payload.due_date !== undefined ? { due_date: toDate(payload.due_date) } : {}),
            ...(payload.sort_order !== undefined ? { sort_order: payload.sort_order } : {}),
        },
        include: INCLUDE,
    });
};

const submitMilestone = async (
    id: string,
    payload: ISubmitMilestonePayload,
    user: IRequestUser
) => {
    const existing = await findOwned(id, user);

    if (existing.submitted_at) {
        throw new AppError(status.CONFLICT, "This milestone has already been submitted");
    }

    const submittedAt = payload.submitted_at ? new Date(payload.submitted_at) : new Date();

    // A delivery dated in the future is a typo, and one that would count as
    // on-time against any date at all.
    if (submittedAt.getTime() > Date.now()) {
        throw new AppError(status.BAD_REQUEST, "Submission date cannot be in the future");
    }

    return prisma.projectMilestone.update({
        where: { id },
        data: { submitted_at: submittedAt },
        include: INCLUDE,
    });
};

const acceptMilestone = async (
    id: string,
    payload: IAcceptMilestonePayload,
    user: IRequestUser
) => {
    const existing = await findOwned(id, user);

    if (!existing.submitted_at) {
        throw new AppError(status.BAD_REQUEST, "Submit the milestone before accepting it");
    }

    if (existing.accepted_at) {
        throw new AppError(status.CONFLICT, "This milestone has already been accepted");
    }

    const acceptedAt = payload.accepted_at ? new Date(payload.accepted_at) : new Date();

    if (acceptedAt.getTime() < existing.submitted_at.getTime()) {
        throw new AppError(status.BAD_REQUEST, "Acceptance cannot pre-date submission");
    }

    return prisma.projectMilestone.update({
        where: { id },
        data: { accepted_at: acceptedAt },
        include: INCLUDE,
    });
};

/**
 * Undo a submission, and the acceptance with it.
 *
 * Leaving accepted_at set on a milestone that is no longer submitted would be a
 * milestone accepted before it was delivered - a state nothing downstream knows
 * how to read.
 */
const reopenMilestone = async (id: string, user: IRequestUser) => {
    const existing = await findOwned(id, user);

    if (!existing.submitted_at) {
        throw new AppError(status.BAD_REQUEST, "This milestone is already open");
    }

    return prisma.projectMilestone.update({
        where: { id },
        data: { submitted_at: null, accepted_at: null },
        include: INCLUDE,
    });
};

const deleteMilestone = async (id: string, user: IRequestUser) => {
    await findOwned(id, user);

    // Soft, like every other delete here, so a mistaken delete is recoverable.
    // Note this DOES remove the milestone from on-time rate, since every read
    // filters deleted rows - deleting a missed milestone quietly improves the
    // number. That is a reason to keep deletion with the people who own the
    // schedule, which the route does, not a reason to hard-delete.
    await prisma.projectMilestone.update({ where: { id }, data: { deleted_at: new Date() } });

    return { message: "Milestone deleted successfully" };
};

export const MilestoneService = {
    getAllMilestones,
    createMilestone,
    updateMilestone,
    submitMilestone,
    acceptMilestone,
    reopenMilestone,
    deleteMilestone,
};
