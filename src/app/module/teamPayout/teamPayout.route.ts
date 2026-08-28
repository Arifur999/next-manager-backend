import { Router } from "express";
import { Role } from "../../../generated/prisma/enums.js";
import { checkAuth } from "../../middleware/checkAuth.js";
import { validateRequest } from "../../middleware/validateRequest.js";
import { TeamPayoutController } from "./teamPayout.controller.js";
import { createTeamPayoutZodSchema, updateTeamPayoutZodSchema } from "./teamPayout.validation.js";

const router = Router();

// What colleagues are paid is sensitive even inside the agency - a project
// manager runs their team without needing to know what each of them is paid.
router.get("/", checkAuth(Role.admin), TeamPayoutController.getAllPayouts);
router.post("/", checkAuth(Role.admin), validateRequest(createTeamPayoutZodSchema), TeamPayoutController.createPayout);
router.patch("/:id", checkAuth(Role.admin), validateRequest(updateTeamPayoutZodSchema), TeamPayoutController.updatePayout);
router.delete("/:id", checkAuth(Role.admin), TeamPayoutController.deletePayout);

export const TeamPayoutRoutes = router;
