import z from "zod";

export const createLeadSourceZodSchema = z.object({
    name: z.string("Name must be a string").min(1, "Name is required"),
    is_active: z.boolean("is_active must be a boolean").optional(),
});

export const updateLeadSourceZodSchema = createLeadSourceZodSchema.partial();

export type ICreateLeadSourcePayload = z.infer<typeof createLeadSourceZodSchema>;
export type IUpdateLeadSourcePayload = z.infer<typeof updateLeadSourceZodSchema>;
