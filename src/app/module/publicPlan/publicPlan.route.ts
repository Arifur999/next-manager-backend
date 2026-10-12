import { Router } from "express";
import { publicReadRateLimit } from "../../middleware/rateLimit.js";
import { PublicPlanController } from "./publicPlan.controller.js";

const router = Router();

// Unauthenticated on purpose: the marketing site lists the plans before anyone
// has an account.
router.get("/", publicReadRateLimit, PublicPlanController.getActivePlans);

export const PublicPlanRoutes = router;
