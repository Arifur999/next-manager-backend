import { Router } from "express";
import { Role } from "../../../generated/prisma/enums.js";
import { checkAuth } from "../../middleware/checkAuth.js";
import { ActivityController } from "./activity.controller.js";

const router = Router();

// Admin only. The feed names who did what across the whole company, including
// money nobody else may read - a salesperson able to see every payment
// recorded and deleted has been handed the finance screens sideways.
//
// No POST, no PATCH, no DELETE, and not by accident: a history somebody can
// edit answers no question worth asking.
router.get("/", checkAuth(Role.admin), ActivityController.getActivity);
router.get("/filters", checkAuth(Role.admin), ActivityController.getActivityFilters);

export const ActivityRoutes = router;
