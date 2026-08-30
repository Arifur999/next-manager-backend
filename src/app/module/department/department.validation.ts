import z from "zod";

export const createDepartmentZodSchema = z.object({
    name: z
        .string("Name must be a string")
        .min(1, "Name is required")
        .max(60, "That is longer than a team name"),
    description: z.string("Description must be a string").max(200).optional(),
    is_active: z.boolean("is_active must be a boolean").optional(),
});

export const updateDepartmentZodSchema = createDepartmentZodSchema.partial();

export type ICreateDepartmentPayload = z.infer<typeof createDepartmentZodSchema>;
export type IUpdateDepartmentPayload = z.infer<typeof updateDepartmentZodSchema>;
