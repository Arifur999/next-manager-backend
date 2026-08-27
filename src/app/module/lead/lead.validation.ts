import z from "zod";
import { LeadStage } from "../../../generated/prisma/enums.js";

export const createLeadZodSchema = z.object({
    name: z.string("Name must be string").min(1, "Name is required"),
    company: z.string("Company must be string").optional(),
    email: z.email("Enter a valid email address").optional().or(z.literal("")),
    phone: z.string("Phone must be string").optional(),
    source: z.string("Source must be string").optional(),
    stage: z.enum(LeadStage, "Choose a valid stage").optional(),
    // Estimates are always USD - that is the currency the agency bills in.
    estimated_value_usd: z.number("Estimated value must be a number").nonnegative().optional(),
    notes: z.string("Notes must be string").optional(),
});

export const updateLeadZodSchema = createLeadZodSchema.partial();

export type ICreateLeadPayload = z.infer<typeof createLeadZodSchema>;
export type IUpdateLeadPayload = z.infer<typeof updateLeadZodSchema>;
