import { Router } from "express";
import { Role } from "../../../generated/prisma/enums.js";
import { checkAuth } from "../../middleware/checkAuth.js";
import { DashboardController } from "./dashboard.controller.js";

const router = Router();

// Revenue and balances are on this response, so it stops at manager. A member
// gets their own task view instead, which is its own route.
router.get("/", checkAuth(Role.owner, Role.admin, Role.manager), DashboardController.getOverview);

export const DashboardRoutes = router;
