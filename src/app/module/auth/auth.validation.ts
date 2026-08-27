import z from "zod";

export const registerZodSchema = z.object({
    // Signing up creates the agency too, so its name is required here rather
    // than being a later settings step.
    organization_name: z.string("Agency name must be string").min(1, "Agency name is required"),
    full_name: z.string("Full name must be string").min(1, "Full name is required"),
    email: z.string("Email must be string").email("Enter a valid email address"),
    password: z
        .string("Password must be string")
        .min(8, "Password must be at least 8 characters")
        .regex(/[A-Za-z]/, "Password must contain a letter")
        .regex(/[0-9]/, "Password must contain a number"),
    phone: z.string("Phone must be string").optional(),
});

export const loginZodSchema = z.object({
    email: z.string("Email must be string").email("Enter a valid email address"),
    password: z.string("Password must be string").min(1, "Password is required"),
});

export const changePasswordZodSchema = z.object({
    old_password: z.string("Old password must be string").min(1, "Old password is required"),
    new_password: z
        .string("New password must be string")
        .min(8, "Password must be at least 8 characters")
        .regex(/[A-Za-z]/, "Password must contain a letter")
        .regex(/[0-9]/, "Password must contain a number"),
});

export type IRegisterPayload = z.infer<typeof registerZodSchema>;
export type ILoginPayload = z.infer<typeof loginZodSchema>;
export type IChangePasswordPayload = z.infer<typeof changePasswordZodSchema>;
