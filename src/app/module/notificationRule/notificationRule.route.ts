import { Router } from "express";
import { Role } from "../../../generated/prisma/enums.js";
import { checkAuth } from "../../middleware/checkAuth.js";
import { requireCompany } from "../../middleware/requireCompany.js";
import { validateRequest } from "../../middleware/validateRequest.js";
import { NotificationRuleController } from "./notificationRule.controller.js";
import { setNotificationRuleZodSchema } from "./notificationRule.validation.js";

const router = Router();

// Admin only. Turning an event off decides what everybody else never hears
// about, which is not a preference somebody sets for the whole company from
// their own screen.
router.get("/", checkAuth(Role.admin), requireCompany, NotificationRuleController.getRules);
router.patch(
    "/:event",
    checkAuth(Role.admin),
    requireCompany,
    validateRequest(setNotificationRuleZodSchema),
    NotificationRuleController.setRule
);

export const NotificationRuleRoutes = router;
