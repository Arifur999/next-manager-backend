import z from "zod";
import { SubscriptionStatus } from "../../../generated/prisma/enums.js";

export const createPlanZodSchema = z.object({
    code: z
        .string("Code must be a string")
        .min(1, "Code is required")
        .regex(/^[a-z0-9_]+$/, "Code must be lowercase letters, numbers and underscores"),
    name: z.string("Name must be a string").min(1, "Name is required"),
    description: z.string("Description must be a string").optional(),
    price_usd: z.number("Price must be a number").nonnegative("Price cannot be negative").optional(),
    // Null is unlimited, which is a different thing from a limit of zero - a
    // plan nobody can add anybody to is not a plan. `.positive()` makes that
    // difference impossible to express by accident.
    max_seats: z
        .number("Seats must be a number")
        .int()
        .positive("A plan with zero seats cannot be used - leave it empty for unlimited")
        .optional()
        .nullable(),
    max_projects: z
        .number("Projects must be a number")
        .int()
        .positive("A plan with zero projects cannot be used - leave it empty for unlimited")
        .optional()
        .nullable(),
    features: z.array(z.string("Each feature must be a string")).optional(),
    is_active: z.boolean("is_active must be a boolean").optional(),
    sort_order: z.number("Sort order must be a number").int().optional(),
});

// The code identifies the plan in messages and checks, so it is set once.
export const updatePlanZodSchema = createPlanZodSchema.omit({ code: true }).partial();

export type ICreatePlanPayload = z.infer<typeof createPlanZodSchema>;
export type IUpdatePlanPayload = z.infer<typeof updatePlanZodSchema>;

/**
 * Putting a company on a plan.
 *
 * Everything is optional except the plan, because this one endpoint covers
 * every move the platform makes: starting a trial, converting to paid,
 * extending a period, suspending, restoring.
 */
export const setSubscriptionZodSchema = z.object({
    plan_id: z.uuid("plan_id must be a valid id"),
    status: z.enum(SubscriptionStatus, "Unknown subscription status").optional(),
    trial_ends_at: z.iso.datetime("trial_ends_at must be an ISO datetime").optional().nullable(),
    current_period_end: z.iso
        .datetime("current_period_end must be an ISO datetime")
        .optional()
        .nullable(),
    notes: z.string("Notes must be a string").optional(),
});

export type ISetSubscriptionPayload = z.infer<typeof setSubscriptionZodSchema>;
