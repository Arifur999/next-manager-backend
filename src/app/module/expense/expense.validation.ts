import z from "zod";

export const createExpenseZodSchema = z.object({
    date: z.iso.date("Date must be YYYY-MM-DD"),
    category_id: z.uuid("category_id must be a valid id"),
    amount_bdt: z.number("Amount must be a number").positive("Amount must be greater than zero"),
    // Must be a BDT account - enforced in the service against the real account.
    account_id: z.uuid("account_id must be a valid id"),
    // Set when the cost belongs to a project, so profitability can subtract it.
    // Left out for general overhead.
    project_id: z.uuid("project_id must be a valid id").optional().nullable(),
    vendor: z.string("Vendor must be string").optional(),
    notes: z.string("Notes must be string").optional(),
    receipt_url: z.string("Receipt URL must be string").optional(),
});

export const updateExpenseZodSchema = createExpenseZodSchema.partial();

export type ICreateExpensePayload = z.infer<typeof createExpenseZodSchema>;
export type IUpdateExpensePayload = z.infer<typeof updateExpenseZodSchema>;
