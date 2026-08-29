import z from "zod";

/**
 * Inviting somebody to join as an operations member.
 *
 * No role field. Every invite is for `operations` by construction, so a link
 * cannot be edited into an admin invite by whoever is holding it - and there
 * is nothing in the payload for an attacker to tamper with in the first place.
 */
export const createInviteZodSchema = z.object({
    email: z.string("Email must be a string").email("Enter a valid email address"),
    // Days. Short by default because an invite is a credential sitting in
    // somebody's inbox, and one that never expires is one that works forever.
    expires_in_days: z
        .number("Expiry must be a number")
        .int()
        .min(1, "An invite that expires today is not useful")
        .max(30, "An invite living longer than a month is a credential nobody is watching")
        .optional(),
});

/**
 * Accepting one.
 *
 * The email is deliberately absent: it comes from the invite. Taking it from
 * the form would let whoever holds a leaked link create an account under any
 * address they like, which is the whole thing binding the invite to an email
 * was meant to prevent.
 */
export const acceptInviteZodSchema = z.object({
    full_name: z.string("Name must be a string").min(1, "Your name is required"),
    password: z
        .string("Password must be a string")
        .min(8, "Password must be at least 8 characters")
        .regex(/[A-Za-z]/, "Password must contain a letter")
        .regex(/[0-9]/, "Password must contain a number"),
});

export const rejectMemberZodSchema = z.object({
    // Recorded on the activity entry rather than shown to the person. An admin
    // looking back at "why did we turn them down" is the reader here.
    reason: z.string("Reason must be a string").optional(),
});

export type ICreateInvitePayload = z.infer<typeof createInviteZodSchema>;
export type IAcceptInvitePayload = z.infer<typeof acceptInviteZodSchema>;
export type IRejectMemberPayload = z.infer<typeof rejectMemberZodSchema>;
