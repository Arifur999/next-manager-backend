import z from "zod";
import { lenient, listQuerySchema, optionalFilter } from "../../shared/listQuery.js";
import { TRANSACTION_KINDS } from "./transaction.service.js";

export const transactionListQueryZodSchema = listQuerySchema.extend({
    // An unknown kind shows everything instead of an error page (smoke pins this).
    kind: lenient(z.enum(TRANSACTION_KINDS)),
    account_id: optionalFilter(z.uuid("account_id must be a valid id")),
});
