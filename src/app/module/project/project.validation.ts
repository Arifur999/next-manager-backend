import z from "zod";

export const createProjectZodSchema = z.object({
    client_id: z.uuid("client_id must be a valid id"),
    name: z.string("Name must be string").min(1, "Name is required"),
    // Unique per agency, not globally - two agencies both using "WEB-001" is
    // correct.
    code: z.string("Code must be string").min(1, "Code is required"),
    description: z.string("Description must be string").optional(),
    // An id, not a word: the vocabulary belongs to the agency now. Absent means
    // the board's default.
    status_id: z.uuid("status_id must be a valid id").optional(),
    start_date: z.iso.date("Start date must be YYYY-MM-DD").optional().nullable(),
    end_date: z.iso.date("End date must be YYYY-MM-DD").optional().nullable(),
    // What the client agreed to pay. Always USD - that is what the agency bills.
    contract_value_usd: z.number("Contract value must be a number").nonnegative().optional(),
    notes: z.string("Notes must be string").optional(),
});

export const updateProjectZodSchema = createProjectZodSchema.omit({ code: true }).partial();

export type ICreateProjectPayload = z.infer<typeof createProjectZodSchema>;
export type IUpdateProjectPayload = z.infer<typeof updateProjectZodSchema>;

/**
 * Freezing what was sold, at kickoff.
 *
 * Its own payload rather than fields on updateProject, and deliberately so:
 * contract_value_usd is meant to move as the deal changes, and the baseline is
 * meant not to. If both lived on the same edit form the baseline would drift
 * with every save and scope-change rate would always read zero.
 */
export const setBaselineZodSchema = z.object({
    baseline_hours: z
        .number("Baseline hours must be a number")
        .positive("Baseline hours must be greater than zero"),
    // Defaults to whatever the contract is worth right now, which at kickoff
    // is exactly what "what we sold" means.
    baseline_value_usd: z.number("Baseline value must be a number").nonnegative().optional(),
    // Re-baselining erases the original the drift was being measured from, so
    // it cannot happen by accident.
    replace_existing: z.boolean("replace_existing must be a boolean").optional(),
});

export type ISetBaselinePayload = z.infer<typeof setBaselineZodSchema>;
