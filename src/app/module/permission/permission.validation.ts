import { z } from "zod";
import { Role } from "../../../generated/prisma/enums.js";
import { ACTIONS, MODULES, SCOPES } from "../../shared/permissionCatalogue.js";

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
