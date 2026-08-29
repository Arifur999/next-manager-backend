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

/**
 * What a person may change about themselves.
 *
 * The allow-list is the whole security control, and it is a `z.object` with
 * exactly three keys for a reason: Zod strips unknown keys, so a payload
 * carrying `role: "admin"` or `status` or `permissions` loses them here
 * rather than reaching the update. A self-service endpoint that forwarded the
 * request body would be one POST away from privilege escalation.
 *
 * Email is deliberately absent too — it is the login identifier, and changing
 * it is an account recovery problem, not a profile edit.
 */
export const updateMeZodSchema = z
    .object({
        full_name: z.string("Name must be string").min(1, "Name is required").optional(),
        phone: z.string("Phone must be string").optional(),
        avatar_url: z.string("Avatar must be string").optional(),
    })
    // Strict rather than stripping: an attempt to set `role` should be told
    // no, not silently ignored and reported as a successful save.
    .strict();

export type IUpdateMePayload = z.infer<typeof updateMeZodSchema>;

export const forgotPasswordZodSchema = z.object({
    email: z.string("Email must be string").email("Enter a valid email address"),
});

export const resetPasswordZodSchema = z.object({
    token: z.string("Token must be string").min(1, "Token is required"),
    new_password: z
        .string("New password must be string")
        .min(8, "Password must be at least 8 characters")
        .regex(/[A-Za-z]/, "Password must contain a letter")
        .regex(/[0-9]/, "Password must contain a number"),
});

export type IForgotPasswordPayload = z.infer<typeof forgotPasswordZodSchema>;
export type IResetPasswordPayload = z.infer<typeof resetPasswordZodSchema>;
