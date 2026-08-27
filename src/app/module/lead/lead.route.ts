import { Router } from "express";
import { Role } from "../../../generated/prisma/enums.js";
import { checkAuth } from "../../middleware/checkAuth.js";
import { validateRequest } from "../../middleware/validateRequest.js";
import { LeadController } from "./lead.controller.js";
import { createLeadZodSchema, updateLeadZodSchema } from "./lead.validation.js";

const router = Router();

router.get("/", checkAuth(Role.owner, Role.admin, Role.manager), LeadController.getPipeline);
router.post("/", checkAuth(Role.owner, Role.admin, Role.manager), validateRequest(createLeadZodSchema), LeadController.createLead);
// Dragging a card between columns is a PATCH of `stage`, so the board needs no
// endpoint of its own.
router.patch("/:id", checkAuth(Role.owner, Role.admin, Role.manager), validateRequest(updateLeadZodSchema), LeadController.updateLead);
router.post("/:id/convert", checkAuth(Role.owner, Role.admin, Role.manager), LeadController.convertToClient);
router.delete("/:id", checkAuth(Role.owner, Role.admin), LeadController.deleteLead);

export const LeadRoutes = router;
