import status from "http-status";
import { Prisma } from "../../../generated/prisma/client.js";
import { InvoiceStatus } from "../../../generated/prisma/enums.js";
import AppError from "../../errorHelpers/AppError.js";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import { prisma } from "../../lib/prisma.js";
import { resolveScope } from "../../shared/resolveScope.js";
import { logActivity, money } from "../../shared/activity.js";
import { isOverdue, recalcInvoiceStatus } from "../../shared/invoiceStatus.js";
import { dateRangeWhere, escapeLikeTerm, findPage, type ListOptions } from "../../shared/listQuery.js";
import { ICreateInvoicePayload, IUpdateInvoicePayload } from "./invoice.validation.js";
import { formatInvoiceNumber } from "./invoiceNumber.js";
import { LineItemInput, priceItems } from "./invoicePricing.js";
import { toDateOnly } from "../../shared/dates.js";
import { assertOwnClient, assertOwnProject } from "../../shared/ownership.js";

/**
 * Invoices, billed in USD like everything else client-facing.
 *
 * Totals are computed here from the line items and never taken from the
 * request. A client that sends its own total is either out of date or lying,
 * and either way the figure would end up in receivables.
 */

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

/**
 * Next invoice number, from the highest INV-<n> (up to nine digits) as a number. Text ordering put
 * INV-10000 below INV-9999, and a hand-typed number like Retainer-Q3 is ignored.
 * Simultaneous creates still meet the unique index and get a clean 409.
 */
const nextInvoiceNumber = async (tx: Prisma.TransactionClient, organizationId: string) => {
    const [row] = await tx.$queryRaw<{ seq: number | null }[]>`
        SELECT max(substring(invoice_number from '^INV-([0-9]{1,9})$')::int) AS seq
        FROM invoices
        WHERE organization_id = ${organizationId}
    `;

    return formatInvoiceNumber(row?.seq ?? null);
};

/**
 * Invoices the caller may see, from the invoices view scope. "own" is their
 * book of clients, the same reach the sales reports use; "assigned" is the
 * billing on projects they are on. organization_id always sits above this.
 */
const visibilityScope = async (user: IRequestUser): Promise<Prisma.InvoiceWhereInput> => {
    const scope = await resolveScope(user, "invoices", "view");

    switch (scope) {
        case "all":
            return {};
        case "assigned":
            return { project: { members: { some: { user_id: user.userId } } } };
        case "own":
            return { client: { owner_id: user.userId } };
        case "none":
        default:
            // Matches nothing, so the by-id reads and writes 404 as well.
            return { id: { in: [] } };
    }
};

const decorate = <T extends { status: InvoiceStatus; due_date: Date }>(invoice: T) => ({
    ...invoice,
    is_overdue: isOverdue(invoice),
});

const getAllInvoices = async (user: IRequestUser, options: ListOptions = {}) => {
    const where: Prisma.InvoiceWhereInput = {
        organization_id: user.organizationId,
        deleted_at: null,
        ...(await visibilityScope(user)),
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

    const { rows, total } = await findPage(
        options,
        (page) => prisma.invoice.findMany({ where, include, orderBy: { issue_date: "desc" }, ...page }),
        () => prisma.invoice.count({ where })
    );

    return { rows: rows.map(decorate), total };
};

const getSingleInvoice = async (id: string, user: IRequestUser) => {
    const invoice = await prisma.invoice.findFirst({
        where: { id, organization_id: user.organizationId, deleted_at: null, ...(await visibilityScope(user)) },
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
    await assertOwnClient(tx, payload.client_id, user.organizationId);
    await assertOwnProject(tx, payload.project_id, user.organizationId);
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
                issue_date: toDateOnly(payload.issue_date),
                due_date: toDateOnly(payload.due_date),
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
            where: { id, organization_id: user.organizationId, deleted_at: null, ...(await visibilityScope(user)) },
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
                issue_date: payload.issue_date ? toDateOnly(payload.issue_date) : undefined,
                due_date: payload.due_date ? toDateOnly(payload.due_date) : undefined,
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
