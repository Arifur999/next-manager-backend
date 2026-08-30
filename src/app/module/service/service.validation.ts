import z from "zod";

export const createServiceZodSchema = z.object({
    name: z
        .string("Name must be a string")
        .min(1, "Give it a name")
        .max(80, "That is longer than a name"),
    description: z.string("Description must be a string").max(300).optional(),
    // Nullable: a service can exist before anybody decides how to group it.
    category_id: z.uuid("category_id must be a valid id").nullable().optional(),
    // A starting point, not the price. Zero means "type it each time", which is
    // a real way to sell rather than a missing value.
    default_price_usd: z
        .number("Price must be a number")
        .nonnegative("A price cannot be negative")
        .optional(),
    sort_order: z.number("Order must be a number").int().min(0).optional(),
    is_active: z.boolean("is_active must be true or false").optional(),
});

export const updateServiceZodSchema = createServiceZodSchema.partial();

export const createServiceCategoryZodSchema = z.object({
    name: z.string("Name must be a string").min(1, "Give it a name").max(60),
    sort_order: z.number("Order must be a number").int().min(0).optional(),
    is_active: z.boolean("is_active must be true or false").optional(),
});

export const updateServiceCategoryZodSchema = createServiceCategoryZodSchema.partial();

export const createServiceTemplateZodSchema = z.object({
    name: z.string("Name must be a string").min(1, "Give it a name").max(80),
    description: z.string("Description must be a string").max(300).optional(),
    // A bundle with no lines is a name, not an offer.
    items: z
        .array(
            z.object({
                service_id: z.uuid("service_id must be a valid id"),
                quantity: z
                    .number("Quantity must be a number")
                    .positive("A quantity of zero is not a line"),
            })
        )
        .min(1, "A template needs at least one service on it"),
});

export const updateServiceTemplateZodSchema = createServiceTemplateZodSchema.partial();

export type ICreateServicePayload = z.infer<typeof createServiceZodSchema>;
export type IUpdateServicePayload = z.infer<typeof updateServiceZodSchema>;
export type ICreateServiceCategoryPayload = z.infer<typeof createServiceCategoryZodSchema>;
export type IUpdateServiceCategoryPayload = z.infer<typeof updateServiceCategoryZodSchema>;
export type ICreateServiceTemplatePayload = z.infer<typeof createServiceTemplateZodSchema>;
export type IUpdateServiceTemplatePayload = z.infer<typeof updateServiceTemplateZodSchema>;
