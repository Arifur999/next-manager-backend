import { Router } from "express";
import { Role } from "../../../generated/prisma/enums.js";
import { checkAuth } from "../../middleware/checkAuth.js";
import { requireScope } from "../../middleware/requireScope.js";
import { validateRequest } from "../../middleware/validateRequest.js";
import { LeadController } from "./lead.controller.js";
import { createLeadZodSchema, updateLeadZodSchema } from "./lead.validation.js";

const router = Router();

// The pipeline is sales' own screen. Admin sees it too because pipeline
// coverage is a company-health number, but delivery and operations have no
// reason to see deals that may never happen.
router.get("/", checkAuth(Role.admin, Role.sales), LeadController.getPipeline);
router.post("/", checkAuth(Role.admin, Role.sales), requireScope("leads", "create"), validateRequest(createLeadZodSchema), LeadController.createLead);

// Dragging a card between columns is a PATCH of `stage`, so the board needs no
// endpoint of its own.
router.patch("/:id", checkAuth(Role.admin, Role.sales), requireScope("leads", "edit"), validateRequest(updateLeadZodSchema), LeadController.updateLead);

// The history behind a deal. Admin can read it too - sales-cycle length is a
// company-health number, not just a sales one.
router.get("/:id/stage-events", checkAuth(Role.admin, Role.sales), LeadController.getStageEvents);

// Converting creates a client, which is squarely sales' job.
router.post("/:id/convert", checkAuth(Role.admin, Role.sales), requireScope("leads", "edit"), LeadController.convertToClient);

router.delete("/:id", checkAuth(Role.admin), LeadController.deleteLead);

export const LeadRoutes = router;
