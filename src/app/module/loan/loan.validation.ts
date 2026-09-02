import { z } from "zod";

// A schedule is generated when a loan is created, but the numbers stay the
// agency's: a bank's own EMI table rarely matches a formula exactly, and a
// schedule nobody can correct is one people keep outside the product instead.
const instalmentZodSchema = z.object({
    due_date: z.iso.date("Due date must be YYYY-MM-DD"),
    principal_bdt: z
        .number("Principal must be a number")
        .min(0, "Principal cannot be negative")
        .max(100_000_000, "That is larger than this system records"),
    interest_bdt: z
        .number("Interest must be a number")
        .min(0, "Interest cannot be negative")
        .max(100_000_000, "That is larger than this system records")
        .optional(),
    notes: z.string("Notes must be a string").max(200).optional(),
});

export const createLoanZodSchema = z.object({
    lender: z.string("Lender must be a string").min(1, "Say who lent it").max(120),
    principal_bdt: z
        .number("Principal must be a number")
        .positive("A loan of nothing is not a loan")
        .max(100_000_000, "That is larger than this system records"),
    interest_rate: z
        .number("Interest rate must be a number")
        .min(0, "A rate cannot be negative")
        .max(200, "That rate is not a rate")
        .optional(),
    started_on: z.iso.date("Start date must be YYYY-MM-DD"),
    term_months: z
        .number("Term must be a number")
        .int("Term must be whole months")
        .positive("A term of zero months is not a term")
        .max(600, "That is a fifty year term"),
    // Optional: a loan already part repaid when it is first entered never
    // landed in an account here, and inventing one would invent money.
    account_id: z.uuid("account_id must be a valid id").optional(),
    notes: z.string("Notes must be a string").max(500).optional(),
    // Left out, an equal-principal schedule is generated as a starting point.
    instalments: z.array(instalmentZodSchema).max(600, "Too many instalments").optional(),
});

export const updateLoanZodSchema = z.object({
    lender: z.string("Lender must be a string").min(1).max(120).optional(),
    interest_rate: z.number("Interest rate must be a number").min(0).max(200).optional(),
    notes: z.string("Notes must be a string").max(500).optional(),
    // Only ever set by hand to `closed` - `settled` is what the last payment
    // does on its own, and `active` is where a loan starts.
    status: z.enum(["closed"], "A loan is only closed by hand").optional(),
});

export const setInstalmentsZodSchema = z.object({
    instalments: z
        .array(instalmentZodSchema.extend({ id: z.uuid("id must be a valid id").optional() }))
        .min(1, "A schedule needs at least one instalment")
        .max(600, "Too many instalments"),
});

export const payInstalmentZodSchema = z.object({
    account_id: z.uuid("account_id must be a valid id"),
    // Defaults to today. Backdating a repayment is normal - it is entered after
    // the fact more often than not.
    date: z.iso.date("Date must be YYYY-MM-DD").optional(),
});

// ---------------------------------------------------------------- shareholders

export const createShareholderZodSchema = z.object({
    name: z.string("Name must be a string").min(1, "Give them a name").max(120),
    // Optional: somebody can own part of the business without ever signing in.
    user_id: z.uuid("user_id must be a valid id").optional(),
    share_pct: z
        .number("Share must be a number")
        .min(0, "A share cannot be negative")
        .max(100, "Nobody owns more than all of it")
        .optional(),
    notes: z.string("Notes must be a string").max(500).optional(),
});

export const updateShareholderZodSchema = createShareholderZodSchema
    .partial()
    .extend({ is_active: z.boolean("is_active must be true or false").optional() });

export const createDistributionZodSchema = z.object({
    shareholder_id: z.uuid("shareholder_id must be a valid id"),
    date: z.iso.date("Date must be YYYY-MM-DD"),
    amount_bdt: z
        .number("Amount must be a number")
        .positive("A distribution of nothing is not a distribution")
        .max(100_000_000, "That is larger than this system records"),
    account_id: z.uuid("account_id must be a valid id"),
    notes: z.string("Notes must be a string").max(300).optional(),
});

export type ICreateLoanPayload = z.infer<typeof createLoanZodSchema>;
export type IUpdateLoanPayload = z.infer<typeof updateLoanZodSchema>;
export type ISetInstalmentsPayload = z.infer<typeof setInstalmentsZodSchema>;
export type IPayInstalmentPayload = z.infer<typeof payInstalmentZodSchema>;
export type ICreateShareholderPayload = z.infer<typeof createShareholderZodSchema>;
export type IUpdateShareholderPayload = z.infer<typeof updateShareholderZodSchema>;
export type ICreateDistributionPayload = z.infer<typeof createDistributionZodSchema>;
