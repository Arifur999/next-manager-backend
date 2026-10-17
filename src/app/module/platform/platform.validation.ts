import z from "zod";
import { AnnouncementAudience, SubscriptionStatus } from "../../../generated/prisma/enums.js";
import { PLATFORM_PERMISSIONS } from "./platform.permissions.js";
import { emailField } from "../../shared/emailField.js";
import { optionalFilter, MAX_PAGE_SIZE } from "../../shared/listQuery.js";

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
    // On the public pricing page. Absent on create means shown, like before.
    is_public: z.boolean("is_public must be a boolean").optional(),
    sort_order: z.number("Sort order must be a number").int().optional(),
});

// The code identifies the plan in messages and checks, so it is set once.
export const updatePlanZodSchema = createPlanZodSchema.omit({ code: true }).partial();

export type ICreatePlanPayload = z.infer<typeof createPlanZodSchema>;
export type IUpdatePlanPayload = z.infer<typeof updatePlanZodSchema>;

/**
 * Putting a company on a plan. Everything but the plan is optional, because one
 * endpoint covers every move: trial, paid, extension, suspension and restore.
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
 * Creating a company from the platform side: like sign-up it creates the first
 * admin too, but the operator decides the plan and the trial length.
 */
export const createCompanyZodSchema = z.object({
    name: z.string("Company name must be a string").min(1, "Company name is required"),
    email: emailField().optional(),
    admin_name: z.string("Admin name must be a string").min(1, "The admin's name is required"),
    admin_email: emailField("Enter a valid email address for the admin"),
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
 * Setting what a platform operator may do. The enum is the control: a typo in a
 * free-text permission would grant nothing while looking configured.
 */
export const setPlatformPermissionsZodSchema = z.object({
    permissions: z.array(z.enum(PLATFORM_PERMISSIONS, "Unknown permission")),
});

export type ISetPlatformPermissionsPayload = z.infer<typeof setPlatformPermissionsZodSchema>;

/**
 * Inviting a platform operator, with their starting permissions chosen here. An
 * empty list means full access (requirePermission's hatch), so leaving it empty
 * has to be a deliberate act.
 */
export const createPlatformInviteZodSchema = z.object({
    email: emailField(),
    // At least one, on purpose. An empty list means full access in
    // requirePermission - the hatch that stops the FIRST operator, seeded from
    // .env, locking themselves out. An invited operator always has somebody
    // who can fix their access, so they never need that hatch, and letting an
    // untouched form quietly grant everything is how somebody ends up with the
    // run of the platform by not ticking a box.
    permissions: z
        .array(z.enum(PLATFORM_PERMISSIONS, "Unknown permission"))
        .min(1, "Choose what they may do - an operator with nothing chosen would get everything"),
    expires_in_days: z
        .number("Expiry must be a number")
        .int()
        .min(1, "An invite that expires today is not useful")
        .max(30, "An invite living longer than a month is a credential nobody is watching")
        .optional(),
});

/**
 * Accepting one. No email field: it comes from the invite, or a leaked link could
 * create a platform account - able to suspend any customer - under any address.
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
 * A notice to customers. `send_email` belongs to the draft, so mailing every
 * customer is decided while writing, not on the button that cannot be undone.
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
 * The platform's own configuration. No SMTP fields: mail credentials live in the
 * environment, where they rotate without a database write. `default_plan_id`
 * accepts null, meaning new sign-ups wait to be provisioned by hand.
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

/**
 * Inviting an agency owner. No role field: the flow always produces an agency
 * admin and can never be edited into a platform operator. Without `company_name`
 * the owner types their own on the way in.
 */
export const createAgencyInviteZodSchema = z.object({
    email: emailField("A valid email is required"),
    company_name: z
        .string("Agency name must be a string")
        .max(120, "That is longer than a name")
        .optional(),
    // Absent means the platform default for new sign-ups, which is what the
    // settings screen is for. Explicitly null is not offered: an invite onto
    // nothing is not something anybody means to send.
    plan_id: z.uuid("plan_id must be a valid id").optional(),
    trial_days: z
        .number("Trial days must be a number")
        .int()
        .min(0, "Use 0 for no trial")
        .max(365, "That is longer than a year - check the figure")
        .optional(),
    expires_in_days: z
        .number("Expiry must be a number")
        .int()
        .min(1, "An invite that expires today is not useful")
        .max(60, "An invite living longer than two months is a link nobody is watching")
        .optional(),
});

/**
 * Accepting one.
 *
 * No email field: it comes from the invite. Taking it from the form would let
 * whoever holds a leaked link open an agency under any address.
 */
export const acceptAgencyInviteZodSchema = z.object({
    full_name: z.string("Name must be a string").min(1, "Your name is required"),
    // Only read when the invite carries no name. When it does, that is the
    // agency the deal was agreed with and it does not change on the way in.
    company_name: z
        .string("Agency name must be a string")
        .max(120, "That is longer than a name")
        .optional(),
    password: z
        .string("Password must be a string")
        .min(8, "Password must be at least 8 characters")
        .regex(/[A-Za-z]/, "Password must contain a letter")
        .regex(/[0-9]/, "Password must contain a number"),
});

export type ICreateAgencyInvitePayload = z.infer<typeof createAgencyInviteZodSchema>;
export type IAcceptAgencyInvitePayload = z.infer<typeof acceptAgencyInviteZodSchema>;

export const companyListQueryZodSchema = z.object({
    status: optionalFilter(z.enum(SubscriptionStatus, "Choose a valid subscription status")),
    search: z.string().trim().optional().catch(undefined).transform((term) => term || undefined),
});

export const platformActivityQueryZodSchema = z.object({
    entity_type: optionalFilter(z.string().max(60)),
    actor_id: optionalFilter(z.uuid("actor_id must be a valid id")),
    page: z.coerce.number().int().positive().catch(1).default(1),
    // Capped like every list; a bad value falls back to the default page size.
    limit: z.coerce
        .number()
        .int()
        .positive()
        .transform((limit) => Math.min(limit, MAX_PAGE_SIZE))
        .catch(100)
        .default(100),
});

export const platformTrendQueryZodSchema = z.object({
    // A span that is not a positive whole number of days means the last 90.
    days: z.coerce.number().int().positive().catch(90).default(90),
});
