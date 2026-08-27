import z from "zod";
import { Role } from "../../../generated/prisma/enums.js";

// Team members an owner may create. super_admin and owner are deliberately not
// in this list: neither can be handed out from inside a workspace.
const assignableRoles = [Role.manager, Role.staff, Role.accountant] as const;

export const createUserZodSchema = z.object({
    full_name: z.string("Full name must be string").min(1, "Full name is required"),
    email: z.string("Email must be string").email("Enter a valid email address"),
    password: z
        .string("Password must be string")
        .min(8, "Password must be at least 8 characters")
        .regex(/[A-Za-z]/, "Password must contain a letter")
        .regex(/[0-9]/, "Password must contain a number"),
    phone: z.string("Phone must be string").optional(),
    role: z.enum(assignableRoles, "Choose a valid role"),
    permissions: z.array(z.string()).optional(),
});

export const updateUserZodSchema = createUserZodSchema
    .omit({ password: true, email: true })
    .partial()
    .extend({
        is_active: z.boolean("is_active must be a boolean").optional(),
    });

export type ICreateUserPayload = z.infer<typeof createUserZodSchema>;
export type IUpdateUserPayload = z.infer<typeof updateUserZodSchema>;
