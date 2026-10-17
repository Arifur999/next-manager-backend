import z from "zod";
import { listQuerySchema, optionalFilter, queryBoolean } from "../../shared/listQuery.js";

export const loginEventListQueryZodSchema = listQuerySchema.extend({
    // Anything but "true" or "false" is ignored, so a stale bookmark shows everything.
    success: queryBoolean,
    user_id: optionalFilter(z.uuid("user_id must be a valid id")),
});
