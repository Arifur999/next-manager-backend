import z from "zod";

export const createPaymentZodSchema = z.object({
    client_id: z.uuid("client_id must be a valid id"),
    project_id: z.uuid("project_id must be a valid id").optional().nullable(),
    invoice_id: z.uuid("invoice_id must be a valid id").optional().nullable(),
    date: z.iso.date("Date must be YYYY-MM-DD"),
    amount_usd: z.number("Amount must be a number").positive("Amount must be greater than zero"),
    // Optional: when absent the server fills in the agency's configured rate or
    // the latest fetched one. Sending it lets whoever records the payment pin
    // the rate they actually expect for it.
    reporting_rate: z.number("Rate must be a number").positive("Rate must be greater than zero").optional(),
    // Must be a USD account - enforced in the service, where the account's real
    // currency is known.
    account_id: z.uuid("account_id must be a valid id"),
    reference: z.string("Reference must be string").optional(),
    notes: z.string("Notes must be string").optional(),
});

// Amount, account and date are reverse-and-rewrite operations rather than
// in-place edits (see the service), so the same shape works for both.
export const updatePaymentZodSchema = createPaymentZodSchema.partial();

export type ICreatePaymentPayload = z.infer<typeof createPaymentZodSchema>;
export type IUpdatePaymentPayload = z.infer<typeof updatePaymentZodSchema>;
