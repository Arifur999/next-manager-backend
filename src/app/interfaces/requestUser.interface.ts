import { Role } from "../../generated/prisma/enums.js";

export interface IRequestUser {
    userId: string;
    // Workspace owner id: for owners this equals userId, for team members it
    // points at their owner. Every workspace query is scoped by this.
    ownerId: string;
    role: Role;
    email: string;
    name: string;
    // Copied from users.token_version when the token is minted and compared
    // against the current value on every request, so a password change ends
    // sessions that were already open. Optional: tokens issued before the
    // column existed carry no version and read as 0.
    tokenVersion?: number;
    // What this user may do within their role. Empty means "everything the role
    // allows" - see middleware/requirePermission.ts for why that is safe.
    permissions: string[];
}
