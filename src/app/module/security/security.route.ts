import { Router } from "express";
import { Role } from "../../../generated/prisma/enums.js";
import { checkAuth } from "../../middleware/checkAuth.js";
import { requireCompany } from "../../middleware/requireCompany.js";
import { SecurityController } from "./security.controller.js";

const router = Router();

// Admin only. This is every colleague's sign-in times and addresses, which is
// not something a colleague should be able to read about the rest of the team.
//
// GET only, and permanently: a security log somebody can edit is a security log
// that proves nothing. It ages out on a schedule instead.
router.get("/login-events", checkAuth(Role.admin), requireCompany, SecurityController.getLoginEvents);

export const SecurityRoutes = router;
