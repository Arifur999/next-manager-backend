import { Router } from "express";
import { Role } from "../../../generated/prisma/enums.js";
import { checkAuth } from "../../middleware/checkAuth.js";
import { requirePermission } from "../../middleware/requirePermission.js";
import { validateRequest } from "../../middleware/validateRequest.js";
import { PlatformSettingsController } from "./platformSettings.controller.js";
import { updatePlatformSettingsZodSchema } from "./platform.validation.js";

// How this installation is set up. Its own permission rather than folding into
// admins.manage: one edit here changes what every future customer is put on and
// what every email this server sends, which is a wider blast radius than adding
// a colleague. Mounted by PlatformRoutes under /platform.
const router = Router();

router.get(
    "/settings",
    checkAuth(Role.super_admin),
    requirePermission("platform.settings.manage"),
    PlatformSettingsController.getSettings
);
router.patch(
    "/settings",
    checkAuth(Role.super_admin),
    requirePermission("platform.settings.manage"),
    validateRequest(updatePlatformSettingsZodSchema),
    PlatformSettingsController.updateSettings
);

export const PlatformSettingsRoutes = router;
