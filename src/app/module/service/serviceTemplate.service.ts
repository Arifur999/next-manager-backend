import status from "http-status";
import AppError from "../../errorHelpers/AppError.js";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import { prisma } from "../../lib/prisma.js";
import { logActivity } from "../../shared/activity.js";
import {
    ICreateServiceTemplatePayload,
    IUpdateServiceTemplatePayload,
} from "./service.validation.js";

/**
 * A named bundle, so a repeat offer is one pick rather than five.
 *
 * Deliberately carries no price of its own. What a bundle costs is the sum of
 * what its lines are actually sold at, and a second total stored here would be
 * a second answer to what the client owes - guaranteed to disagree with the
 * invoice the moment one line is discounted.
 *
 * The prices come from the services when a template is applied, and the invoice
 * keeps its own copy from that moment on.
 */

const SELECT = {
    id: true,
    name: true,
    description: true,
    is_active: true,
    items: {
        select: {
            id: true,
            quantity: true,
            sort_order: true,
            service: {
                select: { id: true, name: true, default_price_usd: true, is_active: true },
            },
        },
        orderBy: { sort_order: "asc" },
    },
} as const;

const getAll = async (user: IRequestUser) =>
    prisma.serviceTemplate.findMany({
        where: { organization_id: user.organizationId },
        select: SELECT,
        orderBy: [{ is_active: "desc" }, { name: "asc" }],
    });

/**
 * Every service on the template belongs to the caller's agency.
 *
 * Checked as a set rather than one at a time: a foreign key proves each row
 * exists, not that all of them are ours, and one borrowed id in a list of five
 * is exactly the case a per-row check invites somebody to skip.
 */
const assertOwnServices = async (serviceIds: string[], user: IRequestUser) => {
    if (serviceIds.length === 0) return;

    const found = await prisma.service.count({
        where: { id: { in: serviceIds }, organization_id: user.organizationId },
    });

    if (found !== new Set(serviceIds).size) {
        throw new AppError(status.NOT_FOUND, "One of those services does not exist");
    }
};

const assertUniqueName = async (organizationId: string, name: string, exceptId?: string) => {
    const duplicate = await prisma.serviceTemplate.findFirst({
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

const create = async (payload: ICreateServiceTemplatePayload, user: IRequestUser) => {
    const name = payload.name.trim();
    await assertUniqueName(user.organizationId, name);
    await assertOwnServices(
        payload.items.map((item) => item.service_id),
        user
    );

    return prisma.$transaction(async (tx) => {
        const template = await tx.serviceTemplate.create({
            data: {
                organization_id: user.organizationId,
                name,
                description: payload.description?.trim() ?? "",
                items: {
                    create: payload.items.map((item, index) => ({
                        service_id: item.service_id,
                        quantity: item.quantity,
                        sort_order: index,
                    })),
                },
            },
            select: SELECT,
        });

        await logActivity(
            tx,
            {
                entityType: "service_template",
                entityId: template.id,
                action: "created",
                summary: `Created the "${template.name}" package with ${template.items.length} services`,
            },
            user
        );

        return template;
    });
};

const update = async (
    id: string,
    payload: IUpdateServiceTemplatePayload,
    user: IRequestUser
) => {
    const existing = await prisma.serviceTemplate.findFirst({
        where: { id, organization_id: user.organizationId },
        select: { id: true, name: true },
    });

    if (!existing) {
        throw new AppError(status.NOT_FOUND, "Template not found");
    }

    if (payload.name) await assertUniqueName(user.organizationId, payload.name.trim(), id);

    if (payload.items) {
        await assertOwnServices(
            payload.items.map((item) => item.service_id),
            user
        );
    }

    return prisma.$transaction(async (tx) => {
        // Replaced wholesale rather than diffed. A template is a short list
        // somebody retypes, and matching up which line moved where would be
        // more code than the feature is worth - and would get it wrong the
        // first time two lines swapped places.
        if (payload.items) {
            await tx.serviceTemplateItem.deleteMany({ where: { template_id: id } });
        }

        const template = await tx.serviceTemplate.update({
            where: { id },
            data: {
                ...(payload.name !== undefined ? { name: payload.name.trim() } : {}),
                ...(payload.description !== undefined
                    ? { description: payload.description.trim() }
                    : {}),
                ...(payload.items
                    ? {
                          items: {
                              create: payload.items.map((item, index) => ({
                                  service_id: item.service_id,
                                  quantity: item.quantity,
                                  sort_order: index,
                              })),
                          },
                      }
                    : {}),
            },
            select: SELECT,
        });

        await logActivity(
            tx,
            {
                entityType: "service_template",
                entityId: id,
                action: "updated",
                summary: `Updated the "${template.name}" package`,
            },
            user
        );

        return template;
    });
};

const remove = async (id: string, user: IRequestUser) => {
    const existing = await prisma.serviceTemplate.findFirst({
        where: { id, organization_id: user.organizationId },
        select: { id: true, name: true },
    });

    if (!existing) {
        throw new AppError(status.NOT_FOUND, "Template not found");
    }

    return prisma.$transaction(async (tx) => {
        // Nothing points at a template once it has been applied - an invoice
        // keeps its own lines - so deleting one takes nothing with it.
        await tx.serviceTemplate.delete({ where: { id } });

        await logActivity(
            tx,
            {
                entityType: "service_template",
                entityId: id,
                action: "deleted",
                summary: `Removed the "${existing.name}" package`,
            },
            user
        );

        return { message: "Package removed" };
    });
};

export const ServiceTemplateService = { getAll, create, update, remove };
