import { Role } from "../../generated/prisma/enums.js";
import { env } from "../../config/env.js";
import { prisma } from "../lib/prisma.js";
import { passwordUtils } from "./password.js";

/**
 * Creates the super admin on boot if it isn't there yet.
 *
 * Idempotent on purpose - it runs on every start, and an existing account is
 * left exactly as it is. It never resets the password of an account that already
 * exists, or a redeploy would silently reset it back to whatever is in .env.
 */
export const seedSuperAdmin = async () => {
    const existing = await prisma.user.findUnique({
        where: { email: env.SUPER_ADMIN_EMAIL },
    });

    if (existing) {
        return existing;
    }

    const superAdmin = await prisma.user.create({
        data: {
            full_name: "Super Admin",
            email: env.SUPER_ADMIN_EMAIL,
            password: await passwordUtils.hashPassword(env.SUPER_ADMIN_PASSWORD),
            role: Role.super_admin,
            email_verified: true,
        },
    });

    console.log(`Super admin created: ${superAdmin.email}`);

    return superAdmin;
};
