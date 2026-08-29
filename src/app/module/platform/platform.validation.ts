import z from "zod";
import { AnnouncementAudience, SubscriptionStatus } from "../../../generated/prisma/enums.js";
import { PLATFORM_PERMISSIONS } from "./platform.permissions.js";

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

/**
 * Setting what a platform operator may do.
 *
 * The enum is the control. `User.permissions` has accepted any string since
 * the first week, and a typo stored there is a permission that grants nothing
 * while looking configured.
 */
export const setPlatformPermissionsZodSchema = z.object({
    permissions: z.array(z.enum(PLATFORM_PERMISSIONS, "Unknown permission")),
});

export type ISetPlatformPermissionsPayload = z.infer<typeof setPlatformPermissionsZodSchema>;

/**
 * Inviting a platform operator.
 *
 * The permissions they will start with are chosen here rather than defaulting
 * to everything. An empty list means full access - the hatch in
 * requirePermission - so leaving it empty is a deliberate act, not the path of
 * least resistance.
 */
export const createPlatformInviteZodSchema = z.object({
    email: z.string("Email must be a string").email("Enter a valid email address"),
    permissions: z.array(z.enum(PLATFORM_PERMISSIONS, "Unknown permission")).optional(),
    expires_in_days: z
        .number("Expiry must be a number")
        .int()
        .min(1, "An invite that expires today is not useful")
        .max(30, "An invite living longer than a month is a credential nobody is watching")
        .optional(),
});

/**
 * Accepting one.
 *
 * No email field: it comes from the invite. Taking it from the form would let
 * whoever holds a leaked link create a platform account under any address -
 * and a platform account can suspend every customer you have.
 */
export const acceptPlatformInviteZodSchema = z.object({
    full_name: z.string("Name must be a string").min(1, "Your name is required"),
    password: z
        .string("Password must be a string")
        .min(8, "Password must be at least 8 characters")
        .regex(/[A-Za-z]/, "Password must contain a letter")
        .regex(/[0-9]/, "Password must contain a number"),
});

export type ICreatePlatformInvitePayload = z.infer<typeof createPlatformInviteZodSchema>;
export type IAcceptPlatformInvitePayload = z.infer<typeof acceptPlatformInviteZodSchema>;

export const createPlatformExpenseZodSchema = z.object({
    date: z.iso.date("Date must be YYYY-MM-DD"),
    category: z.string("Category must be a string").optional(),
    description: z.string("Description must be a string").min(1, "Say what it was for"),
    // USD, matching subscription revenue. Net profit only means something when
    // both sides of the subtraction are the same currency.
    amount_usd: z.number("Amount must be a number").positive("An expense of zero is not an expense"),
    notes: z.string("Notes must be a string").optional(),
});

export const updatePlatformExpenseZodSchema = createPlatformExpenseZodSchema.partial();

export type ICreatePlatformExpensePayload = z.infer<typeof createPlatformExpenseZodSchema>;
export type IUpdatePlatformExpensePayload = z.infer<typeof updatePlatformExpenseZodSchema>;

/**
 * A notice to customers.
 *
 * `send_email` is part of the draft rather than the publish call on purpose:
 * the decision to mail thousands of people should be made while writing, in
 * front of the audience picker, not as an afterthought on the button that
 * cannot be undone.
 */
export const createAnnouncementZodSchema = z.object({
    title: z
        .string("Title must be a string")
        .min(1, "Give it a title")
        .max(120, "A title longer than this is a body"),
    body: z.string("Body must be a string").min(1, "Say something"),
    audience: z.enum(AnnouncementAudience, "Pick who this is for").optional(),
    send_email: z.boolean("Send email must be true or false").optional(),
});

export const updateAnnouncementZodSchema = createAnnouncementZodSchema.partial();

export type ICreateAnnouncementPayload = z.infer<typeof createAnnouncementZodSchema>;
export type IUpdateAnnouncementPayload = z.infer<typeof updateAnnouncementZodSchema>;

/**
 * The platform's own configuration.
 *
 * SMTP is absent on purpose: mail credentials belong in the environment, where
 * they can be rotated without a database write. The screen reads their status
 * back, never their values.
 *
 * `default_plan_id` accepts null explicitly - that is "leave new sign-ups
 * unprovisioned and set them up by hand", which is a real choice and the one
 * this installation started with.
 */
export const updatePlatformSettingsZodSchema = z.object({
    product_name: z
        .string("Product name must be a string")
        .min(1, "The product needs a name")
        .max(60, "That will not fit in an email subject line")
        .optional(),
    // Empty is allowed and means "say nothing". An address invented to fill the
    // gap is worse than no address: somebody writes to it and nobody reads it.
    support_email: z
        .union([z.literal(""), z.email("That is not a valid email address")])
        .optional(),
    default_plan_id: z.uuid("Plan id must be a uuid").nullable().optional(),
    default_trial_days: z
        .number("Trial length must be a number")
        .int()
        .min(0, "A trial cannot be negative - use 0 for no trial")
        .max(365, "A trial longer than a year is not a trial")
        .optional(),
});

export type IUpdatePlatformSettingsPayload = z.infer<typeof updatePlatformSettingsZodSchema>;
