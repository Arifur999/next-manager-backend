import z from "zod";

export const createExchangeZodSchema = z.object({
    date: z.iso.date("Date must be YYYY-MM-DD"),
    // Must be a USD account; enforced in the service against the real account.
    from_account_id: z.uuid("from_account_id must be a valid id"),
    // Must be a BDT account.
    to_account_id: z.uuid("to_account_id must be a valid id"),
    amount_usd: z.number("Amount must be a number").positive("Amount must be greater than zero"),
    // The rate ACTUALLY received, not mid-market. Required rather than defaulted
    // from the API: the whole point of this record is what the processor really
    // paid, and silently filling in mid-market would make the books wrong in a
    // way nobody would notice.
    rate: z.number("Rate must be a number").positive("Rate must be greater than zero"),
    fee_usd: z.number("Fee must be a number").nonnegative("Fee cannot be negative").optional(),
    notes: z.string("Notes must be string").optional(),
});

export type ICreateExchangePayload = z.infer<typeof createExchangeZodSchema>;
