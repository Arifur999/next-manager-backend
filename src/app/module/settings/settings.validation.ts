import z from "zod";
import { Currency } from "../../../generated/prisma/enums.js";

export const updateOrganizationZodSchema = z.object({
    name: z.string("Name must be string").min(1, "Name is required").optional(),
    legal_name: z.string("Legal name must be string").optional(),
    email: z.email("Enter a valid email address").optional().or(z.literal("")),
    phone: z.string("Phone must be string").optional(),
    address: z.string("Address must be string").optional(),
    website: z.string("Website must be string").optional(),
    logo_url: z.string("Logo URL must be string").optional(),
    base_currency: z.enum(Currency, "Choose a valid currency").optional(),
    timezone: z.string("Timezone must be string").optional(),
});

export const setDefaultRateZodSchema = z.object({
    // Null clears the override and falls back to the fetched mid-market rate.
    // The range is a sanity guard: a typo like 1180 would silently inflate every
    // reported figure by ten.
    default_usd_rate: z
        .number("Rate must be a number")
        .positive("Rate must be greater than zero")
        .min(50, "That rate looks wrong - check the figure")
        .max(400, "That rate looks wrong - check the figure")
        .nullable(),
});

export type IUpdateOrganizationPayload = z.infer<typeof updateOrganizationZodSchema>;
export type ISetDefaultRatePayload = z.infer<typeof setDefaultRateZodSchema>;
