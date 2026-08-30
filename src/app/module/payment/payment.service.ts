import status from "http-status";
import { Prisma } from "../../../generated/prisma/client.js";
import { Currency, LedgerSource, NotificationEvent } from "../../../generated/prisma/enums.js";
import AppError from "../../errorHelpers/AppError.js";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import { prisma } from "../../lib/prisma.js";
import { logActivity, money } from "../../shared/activity.js";
import { recalcInvoiceStatus } from "../../shared/invoiceStatus.js";
import { assertAccount, reverseLedgerEntries, writeLedgerEntry } from "../../shared/ledger.js";
import { notify } from "../../shared/notify.js";
import { dateRangeWhere, escapeLikeTerm, pageSlice, type ListOptions } from "../../shared/listQuery.js";
import { getReportingRate } from "../../utils/currencyRate.js";
import { ICreatePaymentPayload, IUpdatePaymentPayload } from "./payment.validation.js";

/**
 * Income from clients, always USD.
 *
 * A payment credits a USD account and nothing else. The rate stored on the row
 * is frozen REPORTING metadata so "what did we earn in August, in BDT" has an
 * answer that does not move when today's rate moves - it is not a conversion,
 * and no BDT account is touched here. Real BDT appears only when USD is
 * actually exchanged, which is the exchange module.
 */

const toDate = (value: string) => new Date(`${value}T00:00:00.000Z`);

// Confirms every id in the payload belongs to the caller's agency. Reads are
// scoped by organization already; ids arriving in a request body are the gap.
const assertReferences = async (
    tx: Prisma.TransactionClient,
    payload: { client_id?: string; project_id?: string | null; invoice_id?: string | null },
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

    if (payload.invoice_id) {
        const invoice = await tx.invoice.findFirst({
            where: { id: payload.invoice_id, organization_id: user.organizationId, deleted_at: null },
            select: { id: true },
        });
        if (!invoice) throw new AppError(status.NOT_FOUND, "Invoice not found");
    }
};

const getAllPayments = async (user: IRequestUser, options: ListOptions = {}) => {
    const where: Prisma.PaymentWhereInput = {
        organization_id: user.organizationId,
        deleted_at: null,
        ...dateRangeWhere(options),
        ...(options.search
            ? {
                OR: [
                    { reference: { contains: escapeLikeTerm(options.search), mode: "insensitive" } },
                    { client: { name: { contains: escapeLikeTerm(options.search), mode: "insensitive" } } },
                ],
            }
            : {}),
    };

    const include = {
        client: { select: { id: true, name: true, company: true } },
        project: { select: { id: true, name: true, code: true } },
        account: { select: { id: true, name: true, currency: true } },
    };

    const slice = pageSlice(options);

    if (!slice) {
        const rows = await prisma.payment.findMany({ where, include, orderBy: { date: "desc" } });
        return { rows, total: rows.length };
    }

    const [rows, total] = await Promise.all([
        prisma.payment.findMany({
            where,
            include,
            orderBy: { date: "desc" },
            skip: slice.skip,
            take: slice.take,
        }),
        prisma.payment.count({ where }),
    ]);

    return { rows, total };
};

const createPayment = async (payload: ICreatePaymentPayload, user: IRequestUser) => {
    // Resolved before the transaction opens: this can read the rate table, and
    // there is no reason to hold a write transaction open while it does.
    const rate = payload.reporting_rate ?? (await getReportingRate(user.organizationId));

    if (!rate) {
        throw new AppError(
            status.BAD_REQUEST,
            "No USD rate is available. Set a default rate in Settings, or send one with this payment."
        );
    }

    return prisma.$transaction(async (tx) => {
        await assertReferences(tx, payload, user);
        // A payment is USD by definition; recording one against a BDT wallet
        // would corrupt both balances at once.
        await assertAccount(tx, payload.account_id, user, Currency.USD);

        const date = toDate(payload.date);
        const amountBdt = new Prisma.Decimal(payload.amount_usd).times(rate).toDecimalPlaces(2);

        const payment = await tx.payment.create({
            data: {
                organization_id: user.organizationId,
                client_id: payload.client_id,
                project_id: payload.project_id ?? null,
                invoice_id: payload.invoice_id ?? null,
                date,
                amount_usd: payload.amount_usd,
                reporting_rate: rate,
                amount_bdt_reporting: amountBdt,
                account_id: payload.account_id,
                reference: payload.reference ?? "",
                notes: payload.notes ?? "",
                created_by: user.userId,
            },
        });

        // Positive: money in.
        await writeLedgerEntry(
            tx,
            {
                accountId: payload.account_id,
                date,
                amount: payload.amount_usd,
                sourceType: LedgerSource.payment,
                sourceId: payment.id,
                description: payload.reference || "Client payment",
            },
            user,
            Currency.USD
        );

        // An invoice's status is derived from what has been paid against it, so
        // it has to be reconsidered in the same transaction - otherwise a
        // settled invoice stays "sent" until something else happens to touch it.
        if (payload.invoice_id) {
            await recalcInvoiceStatus(tx, payload.invoice_id, user.organizationId);
        }

        const client = await tx.client.findUnique({ where: { id: payload.client_id }, select: { name: true } });
        await logActivity(tx, {
            entityType: "payment",
            entityId: payment.id,
            action: "created",
            summary: `Recorded ${money(payload.amount_usd, "USD")} from ${client?.name ?? "a client"}`,
        }, user);

        await notify(tx, user, {
            event: NotificationEvent.payment_recorded,
            title: `${money(payload.amount_usd, "USD")} from ${client?.name ?? "a client"}`,
            body: "Recorded against the account it landed in.",
            entityType: "payment",
            entityId: payment.id,
        });

        return payment;
    });
};

/**
 * Editing reverses the payment's ledger effect and writes a fresh entry rather
 * than adjusting the old row in place, so the history shows what happened
 * instead of quietly restating it.
 */
const updatePayment = async (id: string, payload: IUpdatePaymentPayload, user: IRequestUser) => {
    return prisma.$transaction(async (tx) => {
        const existing = await tx.payment.findFirst({
            where: { id, organization_id: user.organizationId, deleted_at: null },
        });

        if (!existing) {
            throw new AppError(status.NOT_FOUND, "Payment not found");
        }

        await assertReferences(tx, payload, user);

        const accountId = payload.account_id ?? existing.account_id;
        await assertAccount(tx, accountId, user, Currency.USD);

        const date = payload.date ? toDate(payload.date) : existing.date;
        const amountUsd = payload.amount_usd ?? existing.amount_usd.toNumber();
        const rate = payload.reporting_rate ?? existing.reporting_rate.toNumber();

        // Only the three fields the ledger actually cares about trigger a
        // rewrite - editing a note should not produce reversal rows.
        const ledgerChanged =
            accountId !== existing.account_id ||
            amountUsd !== existing.amount_usd.toNumber() ||
            date.getTime() !== existing.date.getTime();

        if (ledgerChanged) {
            await reverseLedgerEntries(tx, LedgerSource.payment, id, user, "Payment edited");
            await writeLedgerEntry(
                tx,
                {
                    accountId,
                    date,
                    amount: amountUsd,
                    sourceType: LedgerSource.payment,
                    sourceId: id,
                    description: payload.reference ?? existing.reference ?? "Client payment",
                },
                user,
                Currency.USD
            );
        }

        const updated = await tx.payment.update({
            where: { id },
            data: {
                client_id: payload.client_id ?? undefined,
                project_id: payload.project_id === undefined ? undefined : payload.project_id,
                invoice_id: payload.invoice_id === undefined ? undefined : payload.invoice_id,
                date,
                amount_usd: amountUsd,
                reporting_rate: rate,
                amount_bdt_reporting: new Prisma.Decimal(amountUsd).times(rate).toDecimalPlaces(2),
                account_id: accountId,
                reference: payload.reference ?? undefined,
                notes: payload.notes ?? undefined,
            },
        });

        // Both invoices may need reconsidering: the one this payment used to
        // settle, and the one it now does. Moving a payment between invoices
        // otherwise leaves the old one looking paid.
        const affected = new Set(
            [existing.invoice_id, updated.invoice_id].filter((value): value is string => Boolean(value))
        );

        for (const invoiceId of affected) {
            await recalcInvoiceStatus(tx, invoiceId, user.organizationId);
        }

        return updated;
    });
};

const deletePayment = async (id: string, user: IRequestUser) => {
    return prisma.$transaction(async (tx) => {
        const existing = await tx.payment.findFirst({
            where: { id, organization_id: user.organizationId, deleted_at: null },
        });

        if (!existing) {
            throw new AppError(status.NOT_FOUND, "Payment not found");
        }

        // Reverse rather than delete the ledger rows: a balance that changes
        // with no trace is exactly what this design exists to prevent.
        await reverseLedgerEntries(tx, LedgerSource.payment, id, user, "Payment deleted");

        await tx.payment.update({
            where: { id },
            data: { deleted_at: new Date(), deleted_by: user.userId },
        });

        // Removing the payment that settled an invoice has to walk that invoice
        // back, or the books would carry a "paid" invoice nothing paid for.
        if (existing.invoice_id) {
            await recalcInvoiceStatus(tx, existing.invoice_id, user.organizationId);
        }

        await logActivity(tx, {
            entityType: "payment",
            entityId: id,
            action: "deleted",
            summary: `Deleted a ${money(existing.amount_usd, "USD")} payment`,
        }, user);

        return { message: "Payment deleted successfully" };
    });
};

export const PaymentService = {
    getAllPayments,
    createPayment,
    updatePayment,
    deletePayment,
};
