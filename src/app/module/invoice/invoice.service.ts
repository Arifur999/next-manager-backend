import status from "http-status";
import { Prisma } from "../../../generated/prisma/client.js";
import { InvoiceStatus } from "../../../generated/prisma/enums.js";
import AppError from "../../errorHelpers/AppError.js";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import { prisma } from "../../lib/prisma.js";
import { logActivity, money } from "../../shared/activity.js";
import { isOverdue, recalcInvoiceStatus } from "../../shared/invoiceStatus.js";
import { dateRangeWhere, escapeLikeTerm, pageSlice, type ListOptions } from "../../shared/listQuery.js";
import { ICreateInvoicePayload, IUpdateInvoicePayload } from "./invoice.validation.js";

/**
 * Invoices, billed in USD like everything else client-facing.
 *
 * Totals are computed here from the line items and never taken from the
 * request. A client that sends its own total is either out of date or lying,
 * and either way the figure would end up in receivables.
 */

const toDate = (value: string) => new Date(`${value}T00:00:00.000Z`);

interface LineItemInput {
    service_id?: string | null;
    description: string;
    quantity?: number;
    unit_price?: number;
    sort_order?: number;
}

/**
 * Every service named on the lines belongs to the caller's agency.
 *
 * Checked as a set rather than one at a time: a foreign key proves each row
 * exists, not that all of them are ours, and one borrowed id in a list of five
 * is exactly the case a per-row check invites somebody to skip.
 */
const assertOwnServices = async (items: LineItemInput[], user: IRequestUser) => {
    const ids = [...new Set(items.map((item) => item.service_id).filter(Boolean))] as string[];
    if (ids.length === 0) return;

    const found = await prisma.service.count({
        where: { id: { in: ids }, organization_id: user.organizationId },
    });

    if (found !== ids.length) {
        throw new AppError(status.NOT_FOUND, "One of those services does not exist");
    }
};

/** Line amounts and the invoice total, worked out server-side. */
const priceItems = (items: LineItemInput[], discount: number, tax: number) => {
    const priced = items.map((item, index) => {
        const quantity = new Prisma.Decimal(item.quantity ?? 1);
        const unitPrice = new Prisma.Decimal(item.unit_price ?? 0);
        return {
            // Kept on the line, not resolved at read time: what a line was
            // for is a fact about the invoice, and a service renamed later
            // must not restate what was billed.
            service_id: item.service_id ?? null,
            description: item.description,
            quantity,
            unit_price: unitPrice,
            amount: quantity.times(unitPrice).toDecimalPlaces(2),
            sort_order: item.sort_order ?? index,
        };
    });

    const subtotal = priced.reduce(
        (running, item) => running.plus(item.amount),
        new Prisma.Decimal(0)
    );

    const total = subtotal.minus(discount).plus(tax).toDecimalPlaces(2);

    if (total.lessThan(0)) {
        throw new AppError(status.BAD_REQUEST, "The discount cannot be larger than the invoice subtotal");
    }

    return { priced, subtotal: subtotal.toDecimalPlaces(2), total };
};

/**
 * Next invoice number for the agency, as AGY-0001.
 *
 * Derived from the highest existing number rather than a count, so deleting an
 * invoice cannot make the next one collide with a number already used. Still
 * racy under genuinely simultaneous creates, which the unique index on
 * (organization_id, invoice_number) turns into a clean 409 rather than two
 * invoices sharing a number.
 */
const nextInvoiceNumber = async (tx: Prisma.TransactionClient, organizationId: string) => {
    const latest = await tx.invoice.findFirst({
        where: { organization_id: organizationId },
        orderBy: { invoice_number: "desc" },
        select: { invoice_number: true },
    });

    const trailing = latest?.invoice_number.match(/(\d+)$/);
    const next = trailing ? Number(trailing[1]) + 1 : 1;

    return `INV-${String(next).padStart(4, "0")}`;
};

const decorate = <T extends { status: InvoiceStatus; due_date: Date }>(invoice: T) => ({
    ...invoice,
    is_overdue: isOverdue(invoice),
});

const getAllInvoices = async (user: IRequestUser, options: ListOptions = {}) => {
    const where: Prisma.InvoiceWhereInput = {
        organization_id: user.organizationId,
        deleted_at: null,
        ...dateRangeWhere(options, "issue_date"),
        ...(options.search
            ? {
                OR: [
                    { invoice_number: { contains: escapeLikeTerm(options.search), mode: "insensitive" } },
                    { client: { name: { contains: escapeLikeTerm(options.search), mode: "insensitive" } } },
                ],
            }
            : {}),
    };

    const include = {
        client: { select: { id: true, name: true, company: true } },
        project: { select: { id: true, name: true, code: true } },
        _count: { select: { items: true, payments: true } },
    };

    const slice = pageSlice(options);

    if (!slice) {
        const rows = await prisma.invoice.findMany({ where, include, orderBy: { issue_date: "desc" } });
        return { rows: rows.map(decorate), total: rows.length };
    }

    const [rows, total] = await Promise.all([
        prisma.invoice.findMany({
            where,
            include,
            orderBy: { issue_date: "desc" },
            skip: slice.skip,
            take: slice.take,
        }),
        prisma.invoice.count({ where }),
    ]);

    return { rows: rows.map(decorate), total };
};

const getSingleInvoice = async (id: string, user: IRequestUser) => {
    const invoice = await prisma.invoice.findFirst({
        where: { id, organization_id: user.organizationId, deleted_at: null },
        include: {
            client: { select: { id: true, name: true, company: true, email: true, phone: true } },
            project: { select: { id: true, name: true, code: true } },
            items: { orderBy: { sort_order: "asc" } },
            payments: {
                where: { deleted_at: null },
                select: { id: true, date: true, amount_usd: true, reference: true },
                orderBy: { date: "desc" },
            },
        },
    });

    if (!invoice) {
        throw new AppError(status.NOT_FOUND, "Invoice not found");
    }

    const paid = invoice.payments.reduce(
        (running, payment) => running.plus(payment.amount_usd),
        new Prisma.Decimal(0)
    );

    return {
        ...decorate(invoice),
        paid_usd: paid.toNumber(),
        // Floored at zero so an overpayment shows as settled rather than as a
        // negative amount owing.
        due_usd: Math.max(invoice.total.minus(paid).toNumber(), 0),
    };
};

const assertReferences = async (
    tx: Prisma.TransactionClient,
    payload: { client_id?: string; project_id?: string | null },
    user: IRequestUser
) => {
    if (payload.client_id) {
        const client = await tx.client.findFirst({
            where: { id: payload.client_id, organization_id: user.organizationId, deleted_at: null },
            select: { id: true },
        });
        if (!client) throw new AppError(status.NOT_FOUND, "Client not found");
    }

    if (payload.project_id) {
        const project = await tx.project.findFirst({
            where: { id: payload.project_id, organization_id: user.organizationId, deleted_at: null },
            select: { id: true },
        });
        if (!project) throw new AppError(status.NOT_FOUND, "Project not found");
    }
};

const createInvoice = async (payload: ICreateInvoicePayload, user: IRequestUser) => {
    return prisma.$transaction(async (tx) => {
        await assertReferences(tx, payload, user);

        const discount = payload.discount ?? 0;
        const tax = payload.tax ?? 0;
        await assertOwnServices(payload.items, user);
        const { priced, subtotal, total } = priceItems(payload.items, discount, tax);

        const invoiceNumber = payload.invoice_number ?? (await nextInvoiceNumber(tx, user.organizationId));

        const duplicate = await tx.invoice.findFirst({
            where: { organization_id: user.organizationId, invoice_number: invoiceNumber },
            select: { id: true },
        });

        if (duplicate) {
            throw new AppError(status.CONFLICT, `Invoice number ${invoiceNumber} is already in use`);
        }

        return tx.invoice.create({
            data: {
                organization_id: user.organizationId,
                client_id: payload.client_id,
                project_id: payload.project_id ?? null,
                invoice_number: invoiceNumber,
                issue_date: toDate(payload.issue_date),
                due_date: toDate(payload.due_date),
                status: payload.status ?? InvoiceStatus.draft,
                subtotal,
                discount,
                tax,
                total,
                notes: payload.notes ?? "",
                terms: payload.terms ?? "",
                created_by: user.userId,
                items: { create: priced.map((item) => ({ ...item, organization_id: user.organizationId })) },
            },
            include: { items: { orderBy: { sort_order: "asc" } } },
        });
    });
};

const updateInvoice = async (id: string, payload: IUpdateInvoicePayload, user: IRequestUser) => {
    return prisma.$transaction(async (tx) => {
        const existing = await tx.invoice.findFirst({
            where: { id, organization_id: user.organizationId, deleted_at: null },
        });

        if (!existing) {
            throw new AppError(status.NOT_FOUND, "Invoice not found");
        }

        await assertReferences(tx, payload, user);

        const discount = payload.discount ?? existing.discount.toNumber();
        const tax = payload.tax ?? existing.tax.toNumber();

        let subtotal = existing.subtotal;
        let total = existing.total;

        // Items are replaced wholesale rather than diffed: an invoice is a
        // document, and matching up edited lines by position would silently
        // reattach a payment-relevant amount to the wrong description.
        if (payload.items) {
            await assertOwnServices(payload.items ?? [], user);
            const priced = priceItems(payload.items, discount, tax);
            subtotal = priced.subtotal;
            total = priced.total;

            await tx.invoiceItem.deleteMany({ where: { invoice_id: id } });
            await tx.invoiceItem.createMany({
                data: priced.priced.map((item) => ({
                    ...item,
                    invoice_id: id,
                    organization_id: user.organizationId,
                })),
            });
        } else if (payload.discount !== undefined || payload.tax !== undefined) {
            total = existing.subtotal.minus(discount).plus(tax).toDecimalPlaces(2);
            if (total.lessThan(0)) {
                throw new AppError(status.BAD_REQUEST, "The discount cannot be larger than the invoice subtotal");
            }
        }

        await tx.invoice.update({
            where: { id },
            data: {
                client_id: payload.client_id ?? undefined,
                project_id: payload.project_id === undefined ? undefined : payload.project_id,
                issue_date: payload.issue_date ? toDate(payload.issue_date) : undefined,
                due_date: payload.due_date ? toDate(payload.due_date) : undefined,
                status: payload.status ?? undefined,
                subtotal,
                discount,
                tax,
                total,
                notes: payload.notes ?? undefined,
                terms: payload.terms ?? undefined,
            },
        });

        // The total may have moved past or below what has been paid, so the
        // status has to be reconsidered rather than left as it was.
        await recalcInvoiceStatus(tx, id, user.organizationId);

        return tx.invoice.findFirst({
            where: { id },
            include: { items: { orderBy: { sort_order: "asc" } } },
        });
    });
};

const deleteInvoice = async (id: string, user: IRequestUser) => {
    const existing = await prisma.invoice.findFirst({
        where: { id, organization_id: user.organizationId, deleted_at: null },
    });

    if (!existing) {
        throw new AppError(status.NOT_FOUND, "Invoice not found");
    }

    // Payments reference the invoice with SetNull, so deleting one with money
    // against it would detach the payment and quietly drop the invoice out of
    // receivables while the cash stays counted. Cancelling says what happened.
    const paymentCount = await prisma.payment.count({
        where: { invoice_id: id, organization_id: user.organizationId, deleted_at: null },
    });

    if (paymentCount > 0) {
        throw new AppError(
            status.CONFLICT,
            "This invoice has payments against it. Set its status to cancelled instead."
        );
    }

    // In a transaction with the audit entry, per the rule in shared/activity:
    // an entry for a deletion that then failed to save is worse than none.
    await prisma.$transaction(async (tx) => {
        await tx.invoice.update({
            where: { id },
            data: { deleted_at: new Date(), deleted_by: user.userId },
        });

        await logActivity(
            tx,
            {
                entityType: "invoice",
                entityId: id,
                action: "deleted",
                summary: `Deleted invoice ${existing.invoice_number} for ${money(existing.total, "USD")}`,
            },
            user
        );
    });

    return { message: "Invoice deleted successfully" };
};

export const InvoiceService = {
    getAllInvoices,
    getSingleInvoice,
    createInvoice,
    updateInvoice,
    deleteInvoice,
};
