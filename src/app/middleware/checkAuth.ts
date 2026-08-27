import { NextFunction, Request, Response } from "express";
import status from "http-status";
import { env } from "../../config/env.js";
import { Role } from "../../generated/prisma/enums.js";
import AppError from "../errorHelpers/AppError.js";
import { prisma } from "../lib/prisma.js";
import { cookieUtils } from "../utils/cookie.js";
import { jwtUtils } from "../utils/jwt.js";

/**
 * The outer auth gate, used as a factory on every protected route.
 *
 *   checkAuth()                              any signed-in user
 *   checkAuth(Role.owner, Role.manager)      role allow-list
 *
 * Nothing downstream may widen what this allows - requirePermission only ever
 * narrows within the role decided here.
 */
export const checkAuth = (...authRoles: Role[]) => async (req: Request, res: Response, next: NextFunction) => {
    try {
        const accessToken =
            cookieUtils.getCookie(req, "accessToken") ||
            (req.headers.authorization?.startsWith("Bearer ")
                ? req.headers.authorization.slice(7)
                : undefined);

        if (!accessToken) {
            throw new AppError(status.UNAUTHORIZED, "Unauthorized access! No access token provided.");
        }

        const verifiedToken = jwtUtils.verifyToken(accessToken, env.ACCESS_TOKEN_SECRET);

        if (!verifiedToken.success) {
            throw new AppError(status.UNAUTHORIZED, "Unauthorized access! Invalid access token.");
        }

        const { userId } = verifiedToken.decoded;

        // Projected down to the columns used below. An unfiltered read pulls
        // every column - password hash included - on every single request.
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: {
                id: true,
                email: true,
                full_name: true,
                role: true,
                owner_id: true,
                is_active: true,
                email_verified: true,
                token_version: true,
                permissions: true,
            },
        });

        if (!user) {
            throw new AppError(status.UNAUTHORIZED, "Unauthorized access! User not found.");
        }

        if (!user.is_active) {
            throw new AppError(status.UNAUTHORIZED, "Unauthorized access! User is not active.");
        }

        // A password change bumps token_version, which retires every token
        // issued before it. Tokens minted before this claim existed carry no
        // version and read as 0, matching the column's default - so adding the
        // check signed nobody out.
        if ((verifiedToken.decoded.tokenVersion ?? 0) !== user.token_version) {
            throw new AppError(status.UNAUTHORIZED, "Your password was changed. Please sign in again.");
        }

        if (authRoles.length > 0 && !authRoles.includes(user.role)) {
            throw new AppError(
                status.FORBIDDEN,
                "Forbidden access! You do not have permission to access this resource."
            );
        }

        req.user = {
            userId: user.id,
            // A super admin is its own workspace root; an owner is too. Only a
            // team member inherits someone else's.
            ownerId: user.role === Role.super_admin ? user.id : (user.owner_id ?? user.id),
            role: user.role,
            email: user.email,
            name: user.full_name,
            tokenVersion: user.token_version,
            permissions: user.permissions ?? [],
        };

        next();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
        next(error);
    }
};
