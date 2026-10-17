import { Prisma } from "../../../generated/prisma/client.js";
import { InvoiceStatus, NotificationEvent } from "../../../generated/prisma/enums.js";
import { logger } from "../../lib/logger.js";
import { prisma } from "../../lib/prisma.js";
import { money } from "../../shared/activity.js";
import { notify, sendNotificationMail } from "../../shared/notify.js";

/**
 * The nightly "an invoice goes overdue" notice. An invoice turns overdue the
 * day after its due date (isOverdue compares UTC days), so the job looks for
 * the ones due yesterday that are still owed. Each is claimed by setting
 * overdue_notified_at in the same transaction as the notice, so a second
 * instance or a re-run that night tells nobody twice.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Yesterday as a calendar day: UTC midnight, the way due_date is stored. */
export const yesterdayUtc = (now: Date) =>
    new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - DAY_MS);

/** Sent or partly paid, due yesterday, and not yet told. Drafts, paid and cancelled never are. */
export const overdueInvoiceWhere = (now: Date): Prisma.InvoiceWhereInput => ({
    deleted_at: null,
    status: { in: [InvoiceStatus.sent, InvoiceStatus.partially_paid] },
    due_date: yesterdayUtc(now),
    overdue_notified_at: null,
});

/** What is still owed, floored at zero like the invoice detail. */
export const amountOwed = (total: Prisma.Decimal, payments: Array<{ amount_usd: Prisma.Decimal }>) => {
    const paid = payments.reduce((running, payment) => running.plus(payment.amount_usd), new Prisma.Decimal(0));
    return Prisma.Decimal.max(total.minus(paid), 0);
};

const CANDIDATE_SELECT = {
    id: true,
    organization_id: true,
    invoice_number: true,
    total: true,
    due_date: true,
    client: { select: { name: true } },
    payments: { where: { deleted_at: null }, select: { amount_usd: true } },
} as const;

type Candidate = Prisma.InvoiceGetPayload<{ select: typeof CANDIDATE_SELECT }>;

/** Claims one invoice and writes its notice; null when somebody else claimed it first. */
const claimAndNotify = (invoice: Candidate, now: Date) =>
    prisma.$transaction(async (tx) => {
        const claim = await tx.invoice.updateMany({
            where: { id: invoice.id, overdue_notified_at: null },
            data: { overdue_notified_at: now },
        });

        if (claim.count !== 1) return { claimed: false, mail: null };

        const mail = await notify(
            tx,
            // Nobody did this, so nobody is left out of the audience.
            { organizationId: invoice.organization_id, userId: null },
            {
                event: NotificationEvent.invoice_overdue,
                title: `${invoice.invoice_number} is overdue`,
                body: `${invoice.client.name} still owes ${money(amountOwed(invoice.total, invoice.payments), "USD")}. It was due ${invoice.due_date.toISOString().slice(0, 10)}.`,
                entityType: "invoice",
                entityId: invoice.id,
            }
        );

        return { claimed: true, mail };
    });

/** One pass of the job. Each invoice is its own transaction, so one failure does not hold back the rest. */
export const notifyOverdueInvoices = async (now = new Date()) => {
    const candidates = await prisma.invoice.findMany({
        where: overdueInvoiceWhere(now),
        select: CANDIDATE_SELECT,
    });

    let notified = 0;

    for (const invoice of candidates) {
        try {
            const { claimed, mail } = await claimAndNotify(invoice, now);
            if (claimed) notified += 1;
            await sendNotificationMail(mail);
        } catch (error) {
            // Unclaimed, because the transaction rolled back: tomorrow's pass
            // no longer matches it, so this line is the record that it was missed.
            logger.error("Overdue invoice notice failed", { invoiceId: invoice.id, error });
        }
    }

    return { checked: candidates.length, notified };
};
