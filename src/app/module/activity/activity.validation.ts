import z from "zod";
import { listQuerySchema, optionalFilter } from "../../shared/listQuery.js";

export const activityListQueryZodSchema = listQuerySchema.extend({
    user_id: optionalFilter(z.uuid("user_id must be a valid id")),
    entity_type: optionalFilter(z.string().max(60)),
    action: optionalFilter(z.string().max(60)),
});
