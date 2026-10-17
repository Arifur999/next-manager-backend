import { z } from "zod";
import { Role } from "../../../generated/prisma/enums.js";
import { ACTIONS, MODULES, SCOPES } from "../../shared/permissionCatalogue.js";
import { optionalFilter } from "../../shared/listQuery.js";

// Validated against the catalogue, not against free text. The columns are TEXT
// in the database so a module can be added by a deploy rather than a migration
// — but nothing should be able to WRITE a module the code has never heard of,
// or the screen would show a row nobody can explain.
const square = {
    module: z.enum(MODULES, "Unknown module"),
    action: z.enum(ACTIONS, "Unknown action"),
    scope: z.enum(SCOPES, "Unknown scope"),
};

export const setRolePermissionZodSchema = z.object({
    role: z.enum(Role, "Unknown role"),
    ...square,
});

export const setUserPermissionZodSchema = z.object(square);

export type ISetRolePermissionPayload = z.infer<typeof setRolePermissionZodSchema>;
export type ISetUserPermissionPayload = z.infer<typeof setUserPermissionZodSchema>;

export const userPermissionParams = z.object({
    userId: z.uuid("Invalid user id"),
    module: z.enum(MODULES, "Unknown module"),
    action: z.enum(ACTIONS, "Unknown action"),
});

export const permissionGridQueryZodSchema = z.object({
    user_id: optionalFilter(z.uuid("user_id must be a valid id")),
});
