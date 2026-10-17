import { Prisma } from "../../generated/prisma/client.js";
import { InvoiceStatus } from "../../generated/prisma/enums.js";

/**
 * Invoice status, derived from what has been paid rather than set by hand, so a
 * deleted payment cannot leave an invoice marked paid. Not derived: `draft` (not
 * sent yet; a payment must not send it) and `cancelled` (a decision that
 * outlives payments). `overdue` is never stored, since it depends on today:
 * the read paths apply isOverdue() instead.
 */

const PRESERVED: InvoiceStatus[] = [InvoiceStatus.draft, InvoiceStatus.cancelled];

export const recalcInvoiceStatus = async (
    tx: Prisma.TransactionClient,
    invoiceId: string,
    organizationId: string
): Promise<InvoiceStatus | null> => {
    const invoice = await tx.invoice.findFirst({
        where: { id: invoiceId, organization_id: organizationId },
        select: { id: true, total: true, status: true },
    });

    if (!invoice) return null;

    if (PRESERVED.includes(invoice.status)) {
        return invoice.status;
    }

    const paid = await tx.payment.aggregate({
        where: { invoice_id: invoiceId, organization_id: organizationId, deleted_at: null },
        _sum: { amount_usd: true },
    });

    const paidTotal = paid._sum.amount_usd ?? new Prisma.Decimal(0);

    // greaterThanOrEqualTo, not equals: an overpayment still settles the
    // invoice, and Decimal comparison avoids the float rounding that would make
    // 99.99999 look unpaid.
    let next: InvoiceStatus;
    if (paidTotal.greaterThanOrEqualTo(invoice.total) && invoice.total.greaterThan(0)) {
        next = InvoiceStatus.paid;
    } else if (paidTotal.greaterThan(0)) {
        next = InvoiceStatus.partially_paid;
    } else {
        next = InvoiceStatus.sent;
    }

    if (next !== invoice.status) {
        await tx.invoice.update({ where: { id: invoiceId }, data: { status: next } });
    }

    return next;
};

/**
 * Whether an invoice is past its due date and still owing.
 *
 * Applied on read rather than stored, because it changes with the calendar
 * rather than with anything the app does.
 */
export const isOverdue = (invoice: { status: InvoiceStatus; due_date: Date }): boolean => {
    if (
        invoice.status === InvoiceStatus.paid ||
        invoice.status === InvoiceStatus.draft ||
        invoice.status === InvoiceStatus.cancelled
    ) {
        return false;
    }

    const today = new Date();
    const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());

    return invoice.due_date.getTime() < todayUtc;
};
