import { Router } from "express";
import { Role } from "../../../generated/prisma/enums.js";
import { checkAuth } from "../../middleware/checkAuth.js";
import { authRateLimit } from "../../middleware/rateLimit.js";
import { validateRequest } from "../../middleware/validateRequest.js";
import { SettingsController } from "./settings.controller.js";
import { setDefaultRateZodSchema, updateOrganizationZodSchema } from "./settings.validation.js";

const router = Router();

// The organization profile is on invoices, so anyone who can raise one needs to
// read it - but only owner and admin may change it.
router.get("/organization", checkAuth(), SettingsController.getOrganization);
router.patch("/organization", checkAuth(Role.owner, Role.admin), validateRequest(updateOrganizationZodSchema), SettingsController.updateOrganization);

router.get("/exchange-rates", checkAuth(Role.owner, Role.admin, Role.manager), SettingsController.getRateSettings);
router.patch("/exchange-rates/default", checkAuth(Role.owner, Role.admin), validateRequest(setDefaultRateZodSchema), SettingsController.setDefaultRate);

// Calls out to a third-party API, so it carries the tight limit - a button
// somebody can hold down should not turn into a request flood at the provider.
router.post("/exchange-rates/refresh", checkAuth(Role.owner, Role.admin), authRateLimit, SettingsController.refreshRate);

export const SettingsRoutes = router;
