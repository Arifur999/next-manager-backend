import { Router } from "express";
import { checkAuth } from "../../middleware/checkAuth.js";
import { validateRequest } from "../../middleware/validateRequest.js";
import { idParams } from "../../shared/requestSchemas.js";
import { AnnouncementController } from "./announcement.controller.js";

// The customer half of announcements: the bell.
//
// `checkAuth()` with no role, because a notice about Sunday maintenance is for
// whoever works on Sunday, not only for whoever pays. Nothing here is scoped to
// an organization - the audience is worked out from the reader's own company -
// so requireCompany would add a way to fail and nothing else.
const router = Router();

router.get("/", checkAuth(), AnnouncementController.getMyAnnouncements);
// Its own endpoint because the badge is polled: counting by fetching the list
// would pull every body text across the wire to render one number.
router.get("/unread-count", checkAuth(), AnnouncementController.getUnreadCount);
router.post("/read-all", checkAuth(), AnnouncementController.markAllRead);
router.post("/:id/read", checkAuth(), validateRequest({ params: idParams }), AnnouncementController.markRead);

export const NotificationRoutes = router;
