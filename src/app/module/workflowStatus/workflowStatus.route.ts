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
router.get("/", checkAuth(), requireCompany, WorkflowStatusController.getAll);

router.post(
    "/",
    checkAuth(Role.admin),
    validateRequest(createWorkflowStatusZodSchema),
    WorkflowStatusController.create
);
router.patch(
    "/:id",
    checkAuth(Role.admin),
    validateRequest(updateWorkflowStatusZodSchema),
    WorkflowStatusController.update
);
router.delete("/:id", checkAuth(Role.admin), WorkflowStatusController.remove);

export const WorkflowStatusRoutes = router;
