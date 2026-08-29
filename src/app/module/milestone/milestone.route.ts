import { Router } from "express";
import { Role } from "../../../generated/prisma/enums.js";
import { checkAuth } from "../../middleware/checkAuth.js";
import { requireCompany } from "../../middleware/requireCompany.js";
import { validateRequest } from "../../middleware/validateRequest.js";
import { MilestoneController } from "./milestone.controller.js";
import {
    acceptMilestoneZodSchema,
    createMilestoneZodSchema,
    submitMilestoneZodSchema,
    updateMilestoneZodSchema,
} from "./milestone.validation.js";

const router = Router();

// Reading is open to everyone signed in: operations needs to see what it owes
// and when, and a deadline nobody can look up is not a deadline.
router.get("/", checkAuth(), requireCompany, MilestoneController.getAllMilestones);

// Setting the schedule is the project manager's job by definition.
router.post(
    "/",
    checkAuth(Role.admin, Role.project_manager),
    validateRequest(createMilestoneZodSchema),
    MilestoneController.createMilestone
);
router.patch(
    "/:id",
    checkAuth(Role.admin, Role.project_manager),
    validateRequest(updateMilestoneZodSchema),
    MilestoneController.updateMilestone
);

// Submitting is the delivery act, so operations does it - that is the whole
// role. On-time rate is measured from this timestamp.
router.post(
    "/:id/submit",
    checkAuth(), requireCompany,
    validateRequest(submitMilestoneZodSchema),
    MilestoneController.submitMilestone
);

// Acceptance is a sign-off on someone else's work, so it stays above the
// person who submitted it.
router.post(
    "/:id/accept",
    checkAuth(Role.admin, Role.project_manager),
    validateRequest(acceptMilestoneZodSchema),
    MilestoneController.acceptMilestone
);
router.post(
    "/:id/reopen",
    checkAuth(Role.admin, Role.project_manager),
    MilestoneController.reopenMilestone
);

// Deleting a missed milestone quietly improves the on-time rate, so it stays
// with the people who own the schedule and answer for it.
router.delete("/:id", checkAuth(Role.admin, Role.project_manager), MilestoneController.deleteMilestone);

export const MilestoneRoutes = router;
