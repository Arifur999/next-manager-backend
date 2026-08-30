import status from "http-status";
import { InvoiceStatus } from "../../../generated/prisma/enums.js";
import AppError from "../../errorHelpers/AppError.js";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import { prisma } from "../../lib/prisma.js";
import { logActivity } from "../../shared/activity.js";
import { ICreateServicePayload, IUpdateServicePayload } from "./service.validation.js";

/**
 * What the agency sells.
 *
 * The price on a service is a starting point, never the price. Every invoice
 * line keeps its own unit price, so editing the catalogue cannot restate an
 * invoice already sent - the same rule InvoiceItem follows for its stored
 * amount, and the reason the two are separate fields at all.
 *
 * Retired rather than deleted once anything has been billed against it. The
 * line would otherwise lose what it was for, and "we stopped selling this" is
 * what switching it off already means.
 */

const SELECT = {
    id: true,
    name: true,
    description: true,
    default_price_usd: true,
    is_active: true,
    sort_order: true,
    category: { select: { id: true, name: true } },
} as const;

const getAll = async (user: IRequestUser, filters: { categoryId?: string } = {}) =>
    prisma.service.findMany({
        where: {
            organization_id: user.organizationId,
            ...(filters.categoryId ? { category_id: filters.categoryId } : {}),
        },
        select: {
            ...SELECT,
            // How much is riding on it - what makes deleting one refusable, and
            // what the screen shows instead of a bare delete button.
            _count: { select: { invoice_items: true, projects: true, template_items: true } },
        },
        orderBy: [{ is_active: "desc" }, { sort_order: "asc" }, { name: "asc" }],
    });

const assertUniqueName = async (organizationId: string, name: string, exceptId?: string) => {
    const duplicate = await prisma.service.findFirst({
        where: {
            organization_id: organizationId,
            name: { equals: name, mode: "insensitive" },
            ...(exceptId ? { id: { not: exceptId } } : {}),
        },
        select: { name: true },
    });

    if (duplicate) {
        throw new AppError(status.CONFLICT, `"${duplicate.name}" is already on the list`);
    }
};

/** A category id from a request proves nothing about who owns it. */
const assertOwnCategory = async (categoryId: string | null | undefined, user: IRequestUser) => {
    if (!categoryId) return;

    const category = await prisma.serviceCategory.findFirst({
        where: { id: categoryId, organization_id: user.organizationId },
        select: { id: true },
    });

    if (!category) {
        throw new AppError(status.NOT_FOUND, "Category not found");
    }
};

const create = async (payload: ICreateServicePayload, user: IRequestUser) => {
    const name = payload.name.trim();
    await assertUniqueName(user.organizationId, name);
    await assertOwnCategory(payload.category_id, user);

    return prisma.$transaction(async (tx) => {
        const last = await tx.service.findFirst({
            where: { organization_id: user.organizationId },
            orderBy: { sort_order: "desc" },
            select: { sort_order: true },
        });

        const service = await tx.service.create({
            data: {
                organization_id: user.organizationId,
                name,
                description: payload.description?.trim() ?? "",
                category_id: payload.category_id ?? null,
                default_price_usd: payload.default_price_usd ?? 0,
                sort_order: payload.sort_order ?? (last?.sort_order ?? -1) + 1,
                is_active: payload.is_active ?? true,
            },
            select: SELECT,
        });

        await logActivity(
            tx,
            {
                entityType: "service",
                entityId: service.id,
                action: "created",
                summary: `Added "${service.name}" to what the agency sells`,
            },
            user
        );

        return service;
    });
};

const update = async (id: string, payload: IUpdateServicePayload, user: IRequestUser) => {
    const existing = await prisma.service.findFirst({
        where: { id, organization_id: user.organizationId },
        select: { id: true, name: true },
    });

    if (!existing) {
        throw new AppError(status.NOT_FOUND, "Service not found");
    }

    if (payload.name) await assertUniqueName(user.organizationId, payload.name.trim(), id);
    await assertOwnCategory(payload.category_id, user);

    return prisma.$transaction(async (tx) => {
        const service = await tx.service.update({
            where: { id },
            data: {
                ...(payload.name !== undefined ? { name: payload.name.trim() } : {}),
                ...(payload.description !== undefined
                    ? { description: payload.description.trim() }
                    : {}),
                ...(payload.category_id !== undefined ? { category_id: payload.category_id } : {}),
                ...(payload.default_price_usd !== undefined
                    ? { default_price_usd: payload.default_price_usd }
                    : {}),
                ...(payload.sort_order !== undefined ? { sort_order: payload.sort_order } : {}),
                ...(payload.is_active !== undefined ? { is_active: payload.is_active } : {}),
            },
            select: SELECT,
        });

        await logActivity(
            tx,
            {
                entityType: "service",
                entityId: id,
                action: "updated",
                summary:
                    payload.is_active === false
                        ? `Stopped selling "${service.name}"`
                        : `Updated "${service.name}"`,
            },
            user
        );

        return service;
    });
};

const remove = async (id: string, user: IRequestUser) => {
    const existing = await prisma.service.findFirst({
        where: { id, organization_id: user.organizationId },
        select: {
            id: true,
            name: true,
            _count: { select: { invoice_items: true, projects: true, template_items: true } },
        },
    });

    if (!existing) {
        throw new AppError(status.NOT_FOUND, "Service not found");
    }

    const used =
        existing._count.invoice_items + existing._count.projects + existing._count.template_items;

    if (used > 0) {
        const where = [
            existing._count.invoice_items > 0 ? `${existing._count.invoice_items} invoice lines` : "",
            existing._count.projects > 0 ? `${existing._count.projects} projects` : "",
            existing._count.template_items > 0 ? `${existing._count.template_items} templates` : "",
        ].filter(Boolean);

        throw new AppError(
            status.CONFLICT,
            `"${existing.name}" is on ${where.join(" and ")}. Turn it off instead of deleting it, so their history survives.`
        );
    }

    return prisma.$transaction(async (tx) => {
        await tx.service.delete({ where: { id } });

        await logActivity(
            tx,
            {
                entityType: "service",
                entityId: id,
                action: "deleted",
                summary: `Removed "${existing.name}" from what the agency sells`,
            },
            user
        );

        return { message: "Service removed" };
    });
};

/**
 * What each service has been BILLED, not what it has collected.
 *
 * Deliberately billed. A payment settles a whole invoice, not a line, so
 * attributing part of one to a service would mean inventing an allocation - and
 * an invented number in a revenue report is worse than an honest one that
 * measures something slightly different. The screen says which it is.
 *
 * Drafts and cancelled invoices are excluded: a draft is not billed yet, and a
 * cancelled one never was.
 */
const getRevenue = async (user: IRequestUser) => {
    const [grouped, services, unattributed] = await Promise.all([
        prisma.invoiceItem.groupBy({
            by: ["service_id"],
            where: {
                organization_id: user.organizationId,
                service_id: { not: null },
                invoice: {
                    deleted_at: null,
                    status: { notIn: [InvoiceStatus.draft, InvoiceStatus.cancelled] },
                },
            },
            _sum: { amount: true },
            _count: { _all: true },
        }),
        prisma.service.findMany({
            where: { organization_id: user.organizationId },
            select: { id: true, name: true },
        }),
        // Lines typed by hand rather than picked from the catalogue. Shown as a
        // row rather than dropped, or the totals here would add up to less than
        // the invoices and give no clue why.
        prisma.invoiceItem.aggregate({
            where: {
                organization_id: user.organizationId,
                service_id: null,
                invoice: {
                    deleted_at: null,
                    status: { notIn: [InvoiceStatus.draft, InvoiceStatus.cancelled] },
                },
            },
            _sum: { amount: true },
            _count: { _all: true },
        }),
    ]);

    const nameOf = new Map(services.map((row) => [row.id, row.name]));

    const rows = grouped.map((row) => ({
        service: { id: row.service_id as string, name: nameOf.get(row.service_id as string) ?? "" },
        billed_usd: Number(row._sum.amount ?? 0),
        line_count: row._count._all,
    }));

    if (unattributed._count._all > 0) {
        rows.push({
            service: { id: "", name: "Typed by hand" },
            billed_usd: Number(unattributed._sum.amount ?? 0),
            line_count: unattributed._count._all,
        });
    }

    return rows.sort((a, b) => b.billed_usd - a.billed_usd);
};

export const ServiceService = { getAll, create, update, remove, getRevenue };
