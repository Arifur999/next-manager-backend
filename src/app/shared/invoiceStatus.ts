import { Prisma } from "../../generated/prisma/client.js";
import { InvoiceStatus } from "../../generated/prisma/enums.js";

/**
 * Invoice status, derived from what has actually been paid against it.
 *
 * Status is recomputed from payments rather than set by hand, because the two
 * would otherwise drift the moment somebody edits or deletes a payment: an
 * invoice marked "paid" whose only payment was since removed is a lie the books
 * would carry forever.
 *
 * Two states are deliberately NOT derived:
 *   - `draft`     - a workflow state meaning "not sent yet". A draft with a
 *                   payment against it is odd but is the user's business, and
 *                   silently promoting it would send an invoice they had not
 *                   finished writing.
 *   - `cancelled` - an explicit decision that outlives any payment history.
 *
 * `overdue` is not stored at all. It is a function of today's date, so a stored
 * value would be wrong every morning until something happened to rewrite it -
 * see isOverdue() below, which the read paths apply instead.
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
