import { Router } from "express";
import { Role } from "../../../generated/prisma/enums.js";
import { checkAuth } from "../../middleware/checkAuth.js";
import { DashboardController } from "./dashboard.controller.js";

const router = Router();

// Revenue and balances are on this response, so it is the admin dashboard.
// The other three roles get their own, built from their own numbers.
router.get("/", checkAuth(Role.admin), DashboardController.getOverview);

export const DashboardRoutes = router;
