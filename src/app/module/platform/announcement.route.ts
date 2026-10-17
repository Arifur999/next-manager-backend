import { Router } from "express";
import { Role } from "../../../generated/prisma/enums.js";
import { checkAuth } from "../../middleware/checkAuth.js";
import { requirePermission } from "../../middleware/requirePermission.js";
import { validateRequest } from "../../middleware/validateRequest.js";
import { idParams } from "../../shared/requestSchemas.js";
import { AnnouncementController } from "./announcement.controller.js";
import { createAnnouncementZodSchema, updateAnnouncementZodSchema } from "./platform.validation.js";

// The console half of announcements; the bell is notificationBell.route.ts.
// Writing a draft and sending it are the same permission, because a draft
// nobody may publish is a document, not a feature. Mounted by PlatformRoutes
// under /platform.
const router = Router();

router.get(
    "/announcements",
    checkAuth(Role.super_admin),
    requirePermission("platform.campaigns.send"),
    AnnouncementController.getAnnouncements
);
router.post(
    "/announcements",
    checkAuth(Role.super_admin),
    requirePermission("platform.campaigns.send"),
    validateRequest(createAnnouncementZodSchema),
    AnnouncementController.createAnnouncement
);
router.patch(
    "/announcements/:id",
    checkAuth(Role.super_admin),
    requirePermission("platform.campaigns.send"),
    validateRequest({ params: idParams, body: updateAnnouncementZodSchema }),
    AnnouncementController.updateAnnouncement
);
// Its own endpoint rather than a flag on the edit: this is the one that cannot
// be taken back, and it should not be reachable by a form that autosaves.
router.post(
    "/announcements/:id/publish",
    checkAuth(Role.super_admin),
    requirePermission("platform.campaigns.send"),
    validateRequest({ params: idParams }),
    AnnouncementController.publishAnnouncement
);
router.delete(
    "/announcements/:id",
    checkAuth(Role.super_admin),
    requirePermission("platform.campaigns.send"),
    validateRequest({ params: idParams }),
    AnnouncementController.deleteAnnouncement
);

export const AnnouncementRoutes = router;
