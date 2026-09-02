import z from "zod";
import { LeadStage } from "../../../generated/prisma/enums.js";

export const createLeadZodSchema = z.object({
    name: z.string("Name must be string").min(1, "Name is required"),
    company: z.string("Company must be string").optional(),
    email: z.email("Enter a valid email address").optional().or(z.literal("")),
    phone: z.string("Phone must be string").optional(),
    // A reference now, not free text - see the LeadSource model for why.
    // Null is allowed and means nobody said where it came from, which is a
    // real answer and not the same as "Direct".
    source_id: z.uuid("source_id must be a valid id").optional().nullable(),
    stage: z.enum(LeadStage, "Choose a valid stage").optional(),
    // Estimates are always USD - that is the currency the agency bills in.
    estimated_value_usd: z.number("Estimated value must be a number").nonnegative().optional(),
    notes: z.string("Notes must be string").optional(),
    // Whose deal this is. Left out, it is whoever entered it - and it travels
    // onto the client when the deal is won.
    owner_id: z.uuid("owner_id must be a valid id").nullable().optional(),
});

export const updateLeadZodSchema = createLeadZodSchema.partial();

export type ICreateLeadPayload = z.infer<typeof createLeadZodSchema>;
export type IUpdateLeadPayload = z.infer<typeof updateLeadZodSchema>;
