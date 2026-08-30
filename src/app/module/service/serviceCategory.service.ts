import status from "http-status";
import AppError from "../../errorHelpers/AppError.js";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import { prisma } from "../../lib/prisma.js";
import { logActivity } from "../../shared/activity.js";
import {
    ICreateServiceCategoryPayload,
    IUpdateServiceCategoryPayload,
} from "./service.validation.js";

/**
 * How an agency groups what it sells.
 *
 * Unlike every other reference list here, deleting one is allowed even when
 * services point at it - the foreign key is SetNull rather than Restrict.
 * Grouping is a tidying decision, and refusing it until somebody has moved
 * every service out by hand would make the list harder to keep tidy than to
 * leave wrong.
 *
 * The services survive; only the grouping goes.
 */

const SELECT = {
    id: true,
    name: true,
    is_active: true,
    sort_order: true,
    created_at: true,
} as const;

const getAll = async (user: IRequestUser) =>
    prisma.serviceCategory.findMany({
        where: { organization_id: user.organizationId },
        select: { ...SELECT, _count: { select: { services: true } } },
        orderBy: [{ is_active: "desc" }, { sort_order: "asc" }, { name: "asc" }],
    });

const assertUniqueName = async (organizationId: string, name: string, exceptId?: string) => {
    const duplicate = await prisma.serviceCategory.findFirst({
        where: {
            organization_id: organizationId,
            name: { equals: name, mode: "insensitive" },
            ...(exceptId ? { id: { not: exceptId } } : {}),
        },
        select: { name: true },
    });

    if (duplicate) {
        throw new AppError(status.CONFLICT, `"${duplicate.name}" already exists`);
    }
};

const create = async (payload: ICreateServiceCategoryPayload, user: IRequestUser) => {
    const name = payload.name.trim();
    await assertUniqueName(user.organizationId, name);

    return prisma.$transaction(async (tx) => {
        const category = await tx.serviceCategory.create({
            data: {
                organization_id: user.organizationId,
                name,
                sort_order: payload.sort_order ?? 0,
                is_active: payload.is_active ?? true,
            },
            select: SELECT,
        });

        await logActivity(
            tx,
            {
                entityType: "service_category",
                entityId: category.id,
                action: "created",
                summary: `Added the ${category.name} service category`,
            },
            user
        );

        return category;
    });
};

const update = async (
    id: string,
    payload: IUpdateServiceCategoryPayload,
    user: IRequestUser
) => {
    const existing = await prisma.serviceCategory.findFirst({
        where: { id, organization_id: user.organizationId },
        select: { id: true },
    });

    if (!existing) {
        throw new AppError(status.NOT_FOUND, "Category not found");
    }

    if (payload.name) await assertUniqueName(user.organizationId, payload.name.trim(), id);

    return prisma.$transaction(async (tx) => {
        const category = await tx.serviceCategory.update({
            where: { id },
            data: {
                ...(payload.name !== undefined ? { name: payload.name.trim() } : {}),
                ...(payload.sort_order !== undefined ? { sort_order: payload.sort_order } : {}),
                ...(payload.is_active !== undefined ? { is_active: payload.is_active } : {}),
            },
            select: SELECT,
        });

        await logActivity(
            tx,
            {
                entityType: "service_category",
                entityId: id,
                action: "updated",
                summary: `Updated the ${category.name} service category`,
            },
            user
        );

        return category;
    });
};

const remove = async (id: string, user: IRequestUser) => {
    const existing = await prisma.serviceCategory.findFirst({
        where: { id, organization_id: user.organizationId },
        select: { id: true, name: true, _count: { select: { services: true } } },
    });

    if (!existing) {
        throw new AppError(status.NOT_FOUND, "Category not found");
    }

    return prisma.$transaction(async (tx) => {
        // The services survive - the foreign key drops the grouping and leaves
        // them ungrouped, which is the state they started in.
        await tx.serviceCategory.delete({ where: { id } });

        await logActivity(
            tx,
            {
                entityType: "service_category",
                entityId: id,
                action: "deleted",
                summary:
                    existing._count.services > 0
                        ? `Removed the ${existing.name} category; ${existing._count.services} services are now ungrouped`
                        : `Removed the ${existing.name} service category`,
            },
            user
        );

        return {
            message:
                existing._count.services > 0
                    ? `Category removed. ${existing._count.services} services are now ungrouped.`
                    : "Category removed",
        };
    });
};

export const ServiceCategoryService = { getAll, create, update, remove };
