import { Router } from "express";
import { Role } from "../../../generated/prisma/enums.js";
import { checkAuth } from "../../middleware/checkAuth.js";
import { validateRequest } from "../../middleware/validateRequest.js";
import { TeamPayoutController } from "./teamPayout.controller.js";
import { createTeamPayoutZodSchema, updateTeamPayoutZodSchema } from "./teamPayout.validation.js";

const router = Router();

// What colleagues are paid is sensitive even inside the agency, so this stops
// at admin rather than manager.
router.get("/", checkAuth(Role.owner, Role.admin), TeamPayoutController.getAllPayouts);
router.post("/", checkAuth(Role.owner, Role.admin), validateRequest(createTeamPayoutZodSchema), TeamPayoutController.createPayout);
router.patch("/:id", checkAuth(Role.owner, Role.admin), validateRequest(updateTeamPayoutZodSchema), TeamPayoutController.updatePayout);
router.delete("/:id", checkAuth(Role.owner), TeamPayoutController.deletePayout);

export const TeamPayoutRoutes = router;
