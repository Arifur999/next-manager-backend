import z from "zod";

/** `/:id` on every route that takes one. */
export const idParams = z.object({ id: z.uuid("Invalid id") });

/** Invite links: opaque tokens, so only presence is checked (an unknown one is a 404). */
export const tokenParams = z.object({ token: z.string().min(1, "Token is required") });
