import { Router } from "express";
import { Role } from "../../../generated/prisma/enums.js";
import { checkAuth } from "../../middleware/checkAuth.js";
import { inviteTokenRateLimit } from "../../middleware/rateLimit.js";
import { requirePermission } from "../../middleware/requirePermission.js";
import { validateRequest } from "../../middleware/validateRequest.js";
import { idParams, tokenParams } from "../../shared/requestSchemas.js";
import { PlatformInviteController } from "./platformInvite.controller.js";
import { acceptPlatformInviteZodSchema, createPlatformInviteZodSchema } from "./platform.validation.js";

// Growing the platform team. Every one of these is behind platform.admins.manage -
// the permission that can grant every other, including itself. Mounted by
// PlatformRoutes under /platform.
const router = Router();

router.get(
    "/invites",
    checkAuth(Role.super_admin),
    requirePermission("platform.admins.manage"),
    PlatformInviteController.getInvites
);
router.post(
    "/invites",
    checkAuth(Role.super_admin),
    requirePermission("platform.admins.manage"),
    validateRequest(createPlatformInviteZodSchema),
    PlatformInviteController.createInvite
);
router.delete(
    "/invites/:id",
    checkAuth(Role.super_admin),
    requirePermission("platform.admins.manage"),
    validateRequest({ params: idParams }),
    PlatformInviteController.revokeInvite
);

router.post(
    "/admins/:id/approve",
    checkAuth(Role.super_admin),
    requirePermission("platform.admins.manage"),
    validateRequest({ params: idParams }),
    PlatformInviteController.approveAdmin
);
router.delete(
    "/admins/:id",
    checkAuth(Role.super_admin),
    requirePermission("platform.admins.manage"),
    validateRequest({ params: idParams }),
    PlatformInviteController.removeAdmin
);

export const PlatformInviteRoutes = router;

// Public: whoever opens the link has no account yet.
//
// Its own token space, separate from the company join routes: the two never
// mix, and a token for one can never be mistaken for the other.
const publicRouter = Router();

publicRouter.get("/:token", inviteTokenRateLimit, validateRequest({ params: tokenParams }), PlatformInviteController.getInviteByToken);
publicRouter.post(
    "/:token/accept",
    inviteTokenRateLimit,
    validateRequest({ params: tokenParams, body: acceptPlatformInviteZodSchema }),
    PlatformInviteController.acceptInvite
);

export const PublicPlatformInviteRoutes = publicRouter;
