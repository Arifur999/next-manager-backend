import { Request } from "express";
import z from "zod";

/** `/:id` on every route that takes one. */
export const idParams = z.object({ id: z.uuid("Invalid id") });

export const organizationIdParams = z.object({ organizationId: z.uuid("Invalid company id") });

export const projectIdParams = z.object({ projectId: z.uuid("Invalid project id") });

export const userIdParams = z.object({ userId: z.uuid("Invalid user id") });

export const instalmentIdParams = z.object({ instalmentId: z.uuid("Invalid instalment id") });

/** Invite links: opaque tokens, so only presence is checked (an unknown one is a 404). */
export const tokenParams = z.object({ token: z.string().min(1, "Token is required") });

/**
 * Typed route params for a controller. The route already ran the same schema
 * through validateRequest, so this cannot fail there; it exists so controllers
 * get `string` instead of Express 5's `string | string[]` without a cast.
 */
export const paramsOf = <S extends z.ZodType>(req: Request, schema: S): z.infer<S> => schema.parse(req.params);

/** The validated `:id`. */
export const idOf = (req: Request): string => paramsOf(req, idParams).id;
