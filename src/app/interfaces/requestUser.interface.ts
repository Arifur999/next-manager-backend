import { Role } from "../../generated/prisma/enums.js";

export interface IRequestUser {
    userId: string;
    // The tenant key. Every domain query is scoped by this, and it is resolved
    // once per request in checkAuth rather than read from anything the client
    // sent. A super_admin has none - they belong to no agency.
    organizationId: string;
    role: Role;
    email: string;
    name: string;
    // Copied from users.token_version when the token is minted and compared
    // against the current value on every request, so a password change ends
    // sessions that were already open.
    tokenVersion?: number;
    // What this user may do within their role. Empty means "everything the role
    // allows" - see middleware/requirePermission.ts for why that is safe.
    permissions: string[];
}
