import status from "http-status";
import AppError from "../../errorHelpers/AppError.js";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import { prisma } from "../../lib/prisma.js";
import {
    ICreateLeadSourcePayload,
    IUpdateLeadSourcePayload,
} from "./leadSource.validation.js";

/**
 * The marketplaces and channels a company lands work through.
 *
 * Curated per company rather than fixed, because agencies use different ones -
 * the same reason expense categories are a table and not an enum.
 *
 * Retired rather than deleted once leads point at it: deleting would set every
 * one of those leads back to "nobody said", quietly erasing where months of
 * work came from. `is_active: false` keeps the history and takes it out of the
 * picker, which is what "we stopped using Fiverr" actually means.
 */

const SELECT = { id: true, name: true, is_active: true, created_at: true } as const;

const getAll = async (user: IRequestUser) =>
    prisma.leadSource.findMany({
        where: { organization_id: user.organizationId },
        select: { ...SELECT, _count: { select: { leads: true } } },
        orderBy: [{ is_active: "desc" }, { name: "asc" }],
    });

const create = async (payload: ICreateLeadSourcePayload, user: IRequestUser) => {
    const name = payload.name.trim();

    // Case-insensitive, because the whole point of a reference is that
    // "Upwork" and "upwork" are one marketplace and not two.
    const duplicate = await prisma.leadSource.findFirst({
        where: {
            organization_id: user.organizationId,
            name: { equals: name, mode: "insensitive" },
        },
        select: { id: true, name: true },
    });

    if (duplicate) {
        throw new AppError(status.CONFLICT, `"${duplicate.name}" is already on the list`);
    }

    return prisma.leadSource.create({
        data: {
            organization_id: user.organizationId,
            name,
            is_active: payload.is_active ?? true,
        },
        select: SELECT,
    });
};

const update = async (id: string, payload: IUpdateLeadSourcePayload, user: IRequestUser) => {
    const existing = await prisma.leadSource.findFirst({
        where: { id, organization_id: user.organizationId },
        select: { id: true },
    });

    if (!existing) {
        throw new AppError(status.NOT_FOUND, "Lead source not found");
    }

    if (payload.name) {
        const duplicate = await prisma.leadSource.findFirst({
            where: {
                organization_id: user.organizationId,
                name: { equals: payload.name.trim(), mode: "insensitive" },
                id: { not: id },
            },
            select: { name: true },
        });

        if (duplicate) {
            throw new AppError(status.CONFLICT, `"${duplicate.name}" is already on the list`);
        }
    }

    return prisma.leadSource.update({
        where: { id },
        data: {
            ...(payload.name !== undefined ? { name: payload.name.trim() } : {}),
            ...(payload.is_active !== undefined ? { is_active: payload.is_active } : {}),
        },
        select: SELECT,
    });
};

const remove = async (id: string, user: IRequestUser) => {
    const existing = await prisma.leadSource.findFirst({
        where: { id, organization_id: user.organizationId },
        select: { id: true, name: true, _count: { select: { leads: true } } },
    });

    if (!existing) {
        throw new AppError(status.NOT_FOUND, "Lead source not found");
    }

    // Refused rather than cascading to null. Deleting would erase where every
    // one of those deals came from, and the report that answered "which
    // marketplace pays" would silently lose a column.
    if (existing._count.leads > 0) {
        throw new AppError(
            status.CONFLICT,
            `${existing._count.leads} leads came from ${existing.name}. Turn it off instead of deleting it, so their history survives.`
        );
    }

    await prisma.leadSource.delete({ where: { id } });

    return { message: "Lead source deleted" };
};

export const LeadSourceService = { getAll, create, update, remove };
