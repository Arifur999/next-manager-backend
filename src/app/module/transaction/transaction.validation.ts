import z from "zod";
import { lenient, listQuerySchema, optionalFilter } from "../../shared/listQuery.js";

// The kinds the ledger can be filtered by; transaction.service.ts maps each to its sources.
export const TRANSACTION_KINDS = ["income", "expense", "transfer"] as const;

export type TransactionKind = (typeof TRANSACTION_KINDS)[number];

export const transactionListQueryZodSchema = listQuerySchema.extend({
    // An unknown kind shows everything instead of an error page (smoke pins this).
    kind: lenient(z.enum(TRANSACTION_KINDS)),
    account_id: optionalFilter(z.uuid("account_id must be a valid id")),
});
