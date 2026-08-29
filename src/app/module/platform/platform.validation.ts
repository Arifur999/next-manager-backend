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

/**
 * Creating a company from the platform side.
 *
 * The self-serve route makes a company and its first admin together; so does
 * this, because a company with no way in is not a company. The difference is
 * who decides the plan and the trial length.
 */
export const createCompanyZodSchema = z.object({
    name: z.string("Company name must be a string").min(1, "Company name is required"),
    email: z.string("Email must be a string").email("Enter a valid email address").optional(),
    admin_name: z.string("Admin name must be a string").min(1, "The admin's name is required"),
    admin_email: z
        .string("Admin email must be a string")
        .email("Enter a valid email address for the admin"),
    // Set by whoever is provisioning. They hand it over out of band; the admin
    // changes it, or uses the reset flow.
    admin_password: z
        .string("Password must be a string")
        .min(8, "Password must be at least 8 characters")
        .regex(/[A-Za-z]/, "Password must contain a letter")
        .regex(/[0-9]/, "Password must contain a number"),
    plan_id: z.uuid("plan_id must be a valid id").optional(),
    // Days from now. Absent means no trial - a company provisioned by hand is
    // usually one that has already agreed to pay.
    trial_days: z
        .number("Trial days must be a number")
        .int()
        .min(1, "A trial of zero days is not a trial")
        .max(365, "That is longer than a year - check the figure")
        .optional(),
});

export type ICreateCompanyPayload = z.infer<typeof createCompanyZodSchema>;
