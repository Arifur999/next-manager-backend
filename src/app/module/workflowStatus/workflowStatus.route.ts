import { Router } from "express";
import { Role } from "../../../generated/prisma/enums.js";
import { checkAuth } from "../../middleware/checkAuth.js";
import { requireCompany } from "../../middleware/requireCompany.js";
import { validateRequest } from "../../middleware/validateRequest.js";
import { WorkflowStatusController } from "./workflowStatus.controller.js";
import {
    createWorkflowStatusZodSchema,
    updateWorkflowStatusZodSchema,
} from "./workflowStatus.validation.js";

const router = Router();

// Readable by anyone signed in: every board renders these as its columns, and
// every task form picks from them. Only admin shapes the list - a column
// somebody renames mid-quarter is one no report can be compared across.
// Shaping the board is the project manager's job as much as the admin's: you
// listed Workflow as theirs to control, and a settings page whose every button
// returned 403 would teach them the product is broken rather than that they
// lack a permission.
const boardOwner = [Role.admin, Role.project_manager] as const;

router.get("/", checkAuth(), requireCompany, WorkflowStatusController.getAll);

router.post(
    "/",
    checkAuth(...boardOwner),
    validateRequest(createWorkflowStatusZodSchema),
    WorkflowStatusController.create
);
router.patch(
    "/:id",
    checkAuth(...boardOwner),
    validateRequest(updateWorkflowStatusZodSchema),
    WorkflowStatusController.update
);
router.delete("/:id", checkAuth(...boardOwner), WorkflowStatusController.remove);

export const WorkflowStatusRoutes = router;
