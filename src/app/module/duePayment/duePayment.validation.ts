import z from "zod";
import { DueDirection } from "../../../generated/prisma/enums.js";

export const createDuePersonZodSchema = z.object({
    name: z.string("Name must be string").min(1, "Name is required"),
    phone: z.string("Phone must be string").optional(),
    notes: z.string("Notes must be string").optional(),
});

export const updateDuePersonZodSchema = createDuePersonZodSchema.partial();

export const createDueTransactionZodSchema = z.object({
    due_person_id: z.uuid("due_person_id must be a valid id"),
    date: z.iso.date("Date must be YYYY-MM-DD"),
    // From the agency's point of view: received is money in, payment is out.
    direction: z.enum(DueDirection, "Choose received or payment"),
    amount_bdt: z.number("Amount must be a number").positive("Amount must be greater than zero"),
    account_id: z.uuid("account_id must be a valid id"),
    notes: z.string("Notes must be string").optional(),
});

// No update schema on purpose: a due transaction moved real money through a
// real account, so correcting one is a delete (which reverses the ledger) plus
// a fresh entry, not an in-place edit.

export type ICreateDuePersonPayload = z.infer<typeof createDuePersonZodSchema>;
export type IUpdateDuePersonPayload = z.infer<typeof updateDuePersonZodSchema>;
export type ICreateDueTransactionPayload = z.infer<typeof createDueTransactionZodSchema>;
