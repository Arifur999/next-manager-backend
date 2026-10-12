import z from "zod";

/** An email address, trimmed and lowercased so the same person is one account. */
export const emailField = (message = "Enter a valid email address") =>
    z.string("Email must be a string").trim().toLowerCase().pipe(z.email(message));

/** Matches a stored address whatever its case; older rows were saved as typed. */
export const sameEmail = (email: string) => ({ equals: email, mode: "insensitive" as const });
