import z from "zod";
import { WithdrawalType } from "../../../generated/prisma/enums.js";

export const createOwnerWithdrawalZodSchema = z.object({
    date: z.iso.date("Date must be YYYY-MM-DD"),
    amount_bdt: z.number("Amount must be a number").positive("Amount must be greater than zero"),
    // "reinvestment" money goes back into the business rather than to the
    // owner personally, which reporting treats differently.
    type: z.enum(WithdrawalType, "Choose a valid withdrawal type"),
    account_id: z.uuid("account_id must be a valid id"),
    notes: z.string("Notes must be string").optional(),
});

export const updateOwnerWithdrawalZodSchema = createOwnerWithdrawalZodSchema.partial();

export type ICreateOwnerWithdrawalPayload = z.infer<typeof createOwnerWithdrawalZodSchema>;
export type IUpdateOwnerWithdrawalPayload = z.infer<typeof updateOwnerWithdrawalZodSchema>;
