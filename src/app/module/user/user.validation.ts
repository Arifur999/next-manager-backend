import z from "zod";
import { Role, UserStatus } from "../../../generated/prisma/enums.js";

// Roles an admin may hand out. super_admin is deliberately absent - it is a
// platform role and cannot be granted from inside a company.
const assignableRoles = [Role.admin, Role.sales, Role.project_manager, Role.operations] as const;

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
    // Nullable on purpose: null is "no department", which is a real answer for
    // somebody who works across all of them.
    department_id: z.uuid("department_id must be a valid id").nullable().optional(),
});

export const updateUserZodSchema = createUserZodSchema
    .omit({ password: true, email: true })
    .partial()
    .extend({
        // Replaces is_active. `pending` is deliberately not assignable here:
        // it is what the invite flow sets, and letting an admin push somebody
        // back into it by hand would mean an active person losing access with
        // nothing recording why.
        status: z
            .enum([UserStatus.active, UserStatus.suspended], "Choose a valid status")
            .optional(),
    });

export type ICreateUserPayload = z.infer<typeof createUserZodSchema>;
export type IUpdateUserPayload = z.infer<typeof updateUserZodSchema>;
