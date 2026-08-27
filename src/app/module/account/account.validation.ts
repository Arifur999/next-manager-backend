import z from "zod";
import { AccountType, Currency } from "../../../generated/prisma/enums.js";

export const createAccountZodSchema = z.object({
    name: z.string("Name must be string").min(1, "Name is required"),
    type: z.enum(AccountType, "Choose a valid account type"),
    // Currency is fixed at creation and never editable: changing it would
    // reinterpret every ledger row already written against the account.
    currency: z.enum(Currency, "Choose a valid currency"),
    opening_balance: z.number("Opening balance must be a number").optional(),
    notes: z.string("Notes must be string").optional(),
});

export const updateAccountZodSchema = createAccountZodSchema
    .omit({ currency: true, opening_balance: true })
    .partial()
    .extend({
        is_active: z.boolean("is_active must be a boolean").optional(),
    });

export type ICreateAccountPayload = z.infer<typeof createAccountZodSchema>;
export type IUpdateAccountPayload = z.infer<typeof updateAccountZodSchema>;
