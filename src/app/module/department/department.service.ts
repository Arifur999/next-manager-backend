import status from "http-status";
import AppError from "../../errorHelpers/AppError.js";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import { prisma } from "../../lib/prisma.js";
import { logActivity } from "../../shared/activity.js";
import {
    ICreateDepartmentPayload,
    IUpdateDepartmentPayload,
} from "./department.validation.js";

/**
 * The teams inside an agency.
 *
 * A second axis to role, not a replacement for it. Role answers "what may this
 * person do"; a department answers "which part of the business are they", and
 * no arrangement of roles can answer the second — an agency has designers and
 * developers who are all `operations`.
 *
 * Curated per agency, and retired rather than deleted once people belong to it,
 * the same rule LeadSource follows. Deleting would set every one of those
 * people back to "no department" and quietly erase the shape of the team.
 */

const SELECT = {
    id: true,
    name: true,
    description: true,
    is_active: true,
    created_at: true,
} as const;

const getAll = async (user: IRequestUser) =>
    prisma.department.findMany({
        where: { organization_id: user.organizationId },
        select: {
            ...SELECT,
            // Only people who are still here. A department is not "large"
            // because six people who left were once in it.
            _count: { select: { members: { where: { deleted_at: null } } } },
        },
        orderBy: [{ is_active: "desc" }, { name: "asc" }],
    });

const create = async (payload: ICreateDepartmentPayload, user: IRequestUser) => {
    const name = payload.name.trim();

    // Case-insensitive: the point of a reference list is that "Design" and
    // "design" are one team, not two.
    const duplicate = await prisma.department.findFirst({
        where: {
            organization_id: user.organizationId,
            name: { equals: name, mode: "insensitive" },
        },
        select: { name: true },
    });

    if (duplicate) {
        throw new AppError(status.CONFLICT, `"${duplicate.name}" already exists`);
    }

    return prisma.$transaction(async (tx) => {
        const department = await tx.department.create({
            data: {
                organization_id: user.organizationId,
                name,
                description: payload.description?.trim() ?? "",
                is_active: payload.is_active ?? true,
            },
            select: SELECT,
        });

        await logActivity(
            tx,
            {
                entityType: "department",
                entityId: department.id,
                action: "created",
                summary: `Created the ${department.name} department`,
            },
            user
        );

        return department;
    });
};

const update = async (id: string, payload: IUpdateDepartmentPayload, user: IRequestUser) => {
    const existing = await prisma.department.findFirst({
        where: { id, organization_id: user.organizationId },
        select: { id: true, name: true },
    });

    if (!existing) {
        throw new AppError(status.NOT_FOUND, "Department not found");
    }

    if (payload.name) {
        const duplicate = await prisma.department.findFirst({
            where: {
                organization_id: user.organizationId,
                name: { equals: payload.name.trim(), mode: "insensitive" },
                id: { not: id },
            },
            select: { name: true },
        });

        if (duplicate) {
            throw new AppError(status.CONFLICT, `"${duplicate.name}" already exists`);
        }
    }

    return prisma.$transaction(async (tx) => {
        const department = await tx.department.update({
            where: { id },
            data: {
                ...(payload.name !== undefined ? { name: payload.name.trim() } : {}),
                ...(payload.description !== undefined
                    ? { description: payload.description.trim() }
                    : {}),
                ...(payload.is_active !== undefined ? { is_active: payload.is_active } : {}),
            },
            select: SELECT,
        });

        await logActivity(
            tx,
            {
                entityType: "department",
                entityId: id,
                action: "updated",
                summary:
                    payload.is_active === false
                        ? `Turned off the ${department.name} department`
                        : `Updated the ${department.name} department`,
            },
            user
        );

        return department;
    });
};

const remove = async (id: string, user: IRequestUser) => {
    const existing = await prisma.department.findFirst({
        where: { id, organization_id: user.organizationId },
        select: {
            id: true,
            name: true,
            _count: { select: { members: { where: { deleted_at: null } } } },
        },
    });

    if (!existing) {
        throw new AppError(status.NOT_FOUND, "Department not found");
    }

    // Refused rather than letting the FK null everybody out. The column is
    // SetNull so that removing a department never removes a person - but that
    // safety is for accidents, not for a delete somebody chose.
    if (existing._count.members > 0) {
        throw new AppError(
            status.CONFLICT,
            `${existing._count.members} people are in ${existing.name}. Move them first, or turn it off instead of deleting it.`
        );
    }

    return prisma.$transaction(async (tx) => {
        await tx.department.delete({ where: { id } });

        await logActivity(
            tx,
            {
                entityType: "department",
                entityId: id,
                action: "deleted",
                summary: `Deleted the ${existing.name} department`,
            },
            user
        );

        return { message: "Department deleted" };
    });
};

export const DepartmentService = { getAll, create, update, remove };
