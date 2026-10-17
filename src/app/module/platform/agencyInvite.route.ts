import { Router } from "express";
import { Role } from "../../../generated/prisma/enums.js";
import { checkAuth } from "../../middleware/checkAuth.js";
import { inviteTokenRateLimit } from "../../middleware/rateLimit.js";
import { requirePermission } from "../../middleware/requirePermission.js";
import { validateRequest } from "../../middleware/validateRequest.js";
import { idParams, tokenParams } from "../../shared/requestSchemas.js";
import { AgencyInviteController } from "./agencyInvite.controller.js";
import { acceptAgencyInviteZodSchema, createAgencyInviteZodSchema } from "./platform.validation.js";

// Bringing an agency on: the console's actual job. Gated by companies.manage,
// the same permission as creating one by hand - this is the same act with the
// password step handed back to the person it belongs to. Mounted by
// PlatformRoutes under /platform.
const router = Router();

router.get(
    "/agency-invites",
    checkAuth(Role.super_admin),
    requirePermission("platform.companies.view"),
    AgencyInviteController.getInvites
);
router.post(
    "/agency-invites",
    checkAuth(Role.super_admin),
    requirePermission("platform.companies.manage"),
    validateRequest(createAgencyInviteZodSchema),
    AgencyInviteController.createInvite
);
router.delete(
    "/agency-invites/:id",
    checkAuth(Role.super_admin),
    requirePermission("platform.companies.manage"),
    validateRequest({ params: idParams }),
    AgencyInviteController.revokeInvite
);

export const AgencyInviteRoutes = router;

// Public: opening an agency from an invite.
//
// Its own token space, like the team and platform join links. A token for one
// flow can never be mistaken for a token for another, which matters most here -
// these links produce very different accounts.
const publicRouter = Router();

publicRouter.get("/:token", inviteTokenRateLimit, validateRequest({ params: tokenParams }), AgencyInviteController.getInviteByToken);
publicRouter.post(
    "/:token/accept",
    inviteTokenRateLimit,
    validateRequest({ params: tokenParams, body: acceptAgencyInviteZodSchema }),
    AgencyInviteController.acceptInvite
);

export const PublicAgencyInviteRoutes = publicRouter;
