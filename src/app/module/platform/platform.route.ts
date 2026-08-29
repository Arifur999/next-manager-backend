import { Router } from "express";
import { Role } from "../../../generated/prisma/enums.js";
import { checkAuth } from "../../middleware/checkAuth.js";
import { validateRequest } from "../../middleware/validateRequest.js";
import { PlatformController } from "./platform.controller.js";
import {
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

router.get("/companies", checkAuth(Role.super_admin), PlatformController.getCompanies);
router.patch(
    "/companies/:organizationId/subscription",
    checkAuth(Role.super_admin),
    validateRequest(setSubscriptionZodSchema),
    PlatformController.setSubscription
);

export const PlatformRoutes = router;
