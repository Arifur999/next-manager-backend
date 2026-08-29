import { Router } from "express";
import { Role } from "../../../generated/prisma/enums.js";
import { checkAuth } from "../../middleware/checkAuth.js";
import { validateRequest } from "../../middleware/validateRequest.js";
import { PlatformController } from "./platform.controller.js";
import {
    createCompanyZodSchema,
    createPlanZodSchema,
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
router.get("/plans", checkAuth(Role.super_admin), PlatformController.getPlans);
router.post(
    "/plans",
    checkAuth(Role.super_admin),
    validateRequest(createPlanZodSchema),
    PlatformController.createPlan
);
router.patch(
    "/plans/:id",
    checkAuth(Role.super_admin),
    validateRequest(updatePlanZodSchema),
    PlatformController.updatePlan
);

// What the operator opens the console to see: how many companies, what they
// pay, and which trials are about to lapse.
router.get("/overview", checkAuth(Role.super_admin), PlatformController.getOverview);

// What the platform team has been doing. GET only - a history somebody can
// edit answers nothing.
router.get("/activity", checkAuth(Role.super_admin), PlatformController.getActivity);

router.get("/companies", checkAuth(Role.super_admin), PlatformController.getCompanies);

// Provisioning by hand, for a company that agreed a price before it ever saw
// the sign-up form. Creates the workspace, its first admin and its
// subscription together - a workspace nobody can sign in to is not a
// workspace.
router.post(
    "/companies",
    checkAuth(Role.super_admin),
    validateRequest(createCompanyZodSchema),
    PlatformController.createCompany
);
router.patch(
    "/companies/:organizationId/subscription",
    checkAuth(Role.super_admin),
    validateRequest(setSubscriptionZodSchema),
    PlatformController.setSubscription
);

export const PlatformRoutes = router;
