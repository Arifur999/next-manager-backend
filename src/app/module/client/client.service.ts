import status from "http-status";
import { Prisma } from "../../../generated/prisma/client.js";
import { InvoiceStatus } from "../../../generated/prisma/enums.js";
import AppError from "../../errorHelpers/AppError.js";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import { prisma } from "../../lib/prisma.js";
import { logActivity } from "../../shared/activity.js";
import { escapeLikeTerm, pageSlice, type ListOptions } from "../../shared/listQuery.js";
import { ICreateClientPayload, IUpdateClientPayload } from "./client.validation.js";

const getAllClients = async (user: IRequestUser, options: ListOptions = {}) => {
    const where: Prisma.ClientWhereInput = {
        organization_id: user.organizationId,
        deleted_at: null,
        ...(options.search
            ? {
                OR: [
                    { name: { contains: escapeLikeTerm(options.search), mode: "insensitive" } },
                    { company: { contains: escapeLikeTerm(options.search), mode: "insensitive" } },
                    { email: { contains: escapeLikeTerm(options.search), mode: "insensitive" } },
                ],
            }
            : {}),
    };

    const slice = pageSlice(options);

    if (!slice) {
        const rows = await prisma.client.findMany({ where, orderBy: { created_at: "desc" } });
        return { rows, total: rows.length };
    }

    const [rows, total] = await Promise.all([
        prisma.client.findMany({
            where,
            orderBy: { created_at: "desc" },
            skip: slice.skip,
            take: slice.take,
        }),
        prisma.client.count({ where }),
    ]);

    return { rows, total };
};

const getSingleClient = async (id: string, user: IRequestUser) => {
    const client = await prisma.client.findFirst({
        where: { id, organization_id: user.organizationId, deleted_at: null },
        include: {
            projects: {
                where: { deleted_at: null },
                orderBy: { created_at: "desc" },
            },
        },
    });

    if (!client) {
        throw new AppError(status.NOT_FOUND, "Client not found");
    }

    return client;
};

/**
 * The numbers on a client's Overview tab.
 *
 * Revenue is what was actually RECEIVED, not what was invoiced - an invoice is
 * a claim, a payment is a fact, and conflating them is how an agency talks
 * itself into believing it had a good month. Outstanding is the gap between
 * the two, taken from invoices that are still owing.
 *
 * All USD, because that is what clients are billed in. The BDT column on the
 * payment rows is frozen reporting metadata (see the Payment model) and is
 * summed separately rather than reconverted at today's rate.
 */
const getClientFinancials = async (id: string, user: IRequestUser) => {
    const client = await prisma.client.findFirst({
        where: { id, organization_id: user.organizationId, deleted_at: null },
        select: { id: true, created_at: true },
    });

    if (!client) {
        throw new AppError(status.NOT_FOUND, "Client not found");
    }

    const [received, invoiced, projectCount] = await Promise.all([
        prisma.payment.aggregate({
            where: { client_id: id, organization_id: user.organizationId, deleted_at: null },
            _sum: { amount_usd: true, amount_bdt_reporting: true },
            _count: true,
        }),
        prisma.invoice.aggregate({
            where: {
                client_id: id,
                organization_id: user.organizationId,
                deleted_at: null,
                status: { notIn: [InvoiceStatus.draft, InvoiceStatus.cancelled] },
            },
            _sum: { total: true },
        }),
        prisma.project.count({
            where: { client_id: id, organization_id: user.organizationId, deleted_at: null },
        }),
    ]);

    const totalReceivedUsd = received._sum.amount_usd?.toNumber() ?? 0;
    const totalInvoicedUsd = invoiced._sum.total?.toNumber() ?? 0;

    return {
        // Lifetime value is money in the bank, not money hoped for.
        lifetime_value_usd: totalReceivedUsd,
        lifetime_value_bdt_reporting: received._sum.amount_bdt_reporting?.toNumber() ?? 0,
        total_invoiced_usd: totalInvoicedUsd,
        // Never negative: an overpayment is a credit to handle elsewhere, not a
        // negative receivable that would quietly offset another client's debt.
        outstanding_usd: Math.max(totalInvoicedUsd - totalReceivedUsd, 0),
        payment_count: received._count,
        project_count: projectCount,
        client_since: client.created_at,
    };
};

// Wrapped in a transaction only so the activity entry cannot outlive a failed
// create - the row on its own would not need one.
const createClient = async (payload: ICreateClientPayload, user: IRequestUser) => {
    return prisma.$transaction(async (tx) => {
        const client = await tx.client.create({
            data: {
                organization_id: user.organizationId,
                name: payload.name,
                company: payload.company ?? "",
                email: payload.email ?? "",
                phone: payload.phone ?? "",
                country: payload.country ?? "",
                status: payload.status,
                notes: payload.notes ?? "",
            },
        });

        await logActivity(tx, {
            entityType: "client",
            entityId: client.id,
            action: "created",
            summary: `Added ${client.name} as a client`,
        }, user);

        return client;
    });
};

const updateClient = async (id: string, payload: IUpdateClientPayload, user: IRequestUser) => {
    const existing = await prisma.client.findFirst({
        where: { id, organization_id: user.organizationId, deleted_at: null },
    });

    if (!existing) {
        throw new AppError(status.NOT_FOUND, "Client not found");
    }

    return prisma.client.update({ where: { id }, data: payload });
};

const deleteClient = async (id: string, user: IRequestUser) => {
    const existing = await prisma.client.findFirst({
        where: { id, organization_id: user.organizationId, deleted_at: null },
    });

    if (!existing) {
        throw new AppError(status.NOT_FOUND, "Client not found");
    }

    // Payments and invoices reference the client by a Restrict FK, so removing
    // one with financial history would break the books. Archiving keeps the
    // history readable and takes them out of the working list.
    const paymentCount = await prisma.payment.count({
        where: { client_id: id, organization_id: user.organizationId, deleted_at: null },
    });

    if (paymentCount > 0) {
        throw new AppError(
            status.CONFLICT,
            "This client has recorded payments and cannot be deleted. Set their status to archived instead."
        );
    }

    await prisma.client.update({
        where: { id },
        data: { deleted_at: new Date(), deleted_by: user.userId },
    });

    return { message: "Client deleted successfully" };
};

export const ClientService = {
    getAllClients,
    getSingleClient,
    getClientFinancials,
    createClient,
    updateClient,
    deleteClient,
};
