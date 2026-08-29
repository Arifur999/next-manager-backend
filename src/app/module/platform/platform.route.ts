import { Router } from "express";
import { Role } from "../../../generated/prisma/enums.js";
import { checkAuth } from "../../middleware/checkAuth.js";
import { requirePermission } from "../../middleware/requirePermission.js";
import { validateRequest } from "../../middleware/validateRequest.js";
import { authRateLimit } from "../../middleware/rateLimit.js";
import { PlatformController } from "./platform.controller.js";
import { PlatformInviteController } from "./platformInvite.controller.js";
import {
    acceptPlatformInviteZodSchema,
    createCompanyZodSchema,
    createPlatformInviteZodSchema,
    createPlanZodSchema,
    setPlatformPermissionsZodSchema,
    setSubscriptionZodSchema,
    updatePlanZodSchema,
} from "./platform.validation.js";

const router = Router();

// A company's own standing. Readable by anyone signed in, because "you are out
// of seats" is a message a project manager can hit and it is useless without
// being able to look up the limit.
//
// Note this route is NOT behind checkSubscription: a suspended company has to
// be able to see why it is suspended.
router.get("/subscription", checkAuth(), PlatformController.getMySubscription);

// Everything below is the platform's own console.
router.get(
    "/plans",
    checkAuth(Role.super_admin),
    requirePermission("platform.companies.view"),
    PlatformController.getPlans
);
router.post(
    "/plans",
    checkAuth(Role.super_admin),
    requirePermission("platform.plans.manage"),
    validateRequest(createPlanZodSchema),
    PlatformController.createPlan
);
router.patch(
    "/plans/:id",
    checkAuth(Role.super_admin),
    requirePermission("platform.plans.manage"),
    validateRequest(updatePlanZodSchema),
    PlatformController.updatePlan
);

// What the operator opens the console to see: how many companies, what they
// pay, and which trials are about to lapse.
router.get(
    "/overview",
    checkAuth(Role.super_admin),
    requirePermission("platform.companies.view"),
    PlatformController.getOverview
);

// What the platform team has been doing. GET only - a history somebody can
// edit answers nothing.
router.get(
    "/activity",
    checkAuth(Role.super_admin),
    requirePermission("platform.companies.view"),
    PlatformController.getActivity
);

router.get(
    "/companies",
    checkAuth(Role.super_admin),
    requirePermission("platform.companies.view"),
    PlatformController.getCompanies
);

// Provisioning by hand, for a company that agreed a price before it ever saw
// the sign-up form. Creates the workspace, its first admin and its
// subscription together - a workspace nobody can sign in to is not a
// workspace.
router.post(
    "/companies",
    checkAuth(Role.super_admin),
    requirePermission("platform.companies.manage"),
    validateRequest(createCompanyZodSchema),
    PlatformController.createCompany
);
router.patch(
    "/companies/:organizationId/subscription",
    checkAuth(Role.super_admin),
    requirePermission("platform.companies.manage"),
    validateRequest(setSubscriptionZodSchema),
    PlatformController.setSubscription
);

// The platform team. Managing it is its own permission, and it is the one that
// can grant every other - including itself.
router.get(
    "/admins",
    checkAuth(Role.super_admin),
    requirePermission("platform.admins.manage"),
    PlatformController.getAdmins
);
router.patch(
    "/admins/:id/permissions",
    checkAuth(Role.super_admin),
    requirePermission("platform.admins.manage"),
    validateRequest(setPlatformPermissionsZodSchema),
    PlatformController.setPermissions
);

// Growing the team. Every one of these is behind platform.admins.manage - the
// permission that can grant every other, including itself.
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
    PlatformInviteController.revokeInvite
);

router.post(
    "/admins/:id/approve",
    checkAuth(Role.super_admin),
    requirePermission("platform.admins.manage"),
    PlatformInviteController.approveAdmin
);
router.delete(
    "/admins/:id",
    checkAuth(Role.super_admin),
    requirePermission("platform.admins.manage"),
    PlatformInviteController.removeAdmin
);

export const PlatformRoutes = router;

// ---------------------------------------------------------------------------
// Public. Whoever opens the link has no account yet.
// ---------------------------------------------------------------------------
//
// Its own token space, separate from the company join routes: the two never
// mix, and a token for one can never be mistaken for the other.
const publicRouter = Router();

publicRouter.get("/:token", authRateLimit, PlatformInviteController.getInviteByToken);
publicRouter.post(
    "/:token/accept",
    authRateLimit,
    validateRequest(acceptPlatformInviteZodSchema),
    PlatformInviteController.acceptInvite
);

export const PublicPlatformInviteRoutes = publicRouter;
