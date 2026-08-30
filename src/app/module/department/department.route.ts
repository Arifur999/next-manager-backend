import { Router } from "express";
import { Role } from "../../../generated/prisma/enums.js";
import { checkAuth } from "../../middleware/checkAuth.js";
import { requireCompany } from "../../middleware/requireCompany.js";
import { validateRequest } from "../../middleware/validateRequest.js";
import { DepartmentController } from "./department.controller.js";
import {
    createDepartmentZodSchema,
    updateDepartmentZodSchema,
} from "./department.validation.js";

const router = Router();

// Readable by anyone signed in to the agency: a department is on the team list
// and in the assignee picker, so a project manager needs to see the names.
// Only admin shapes the list - it is a reporting dimension, and one somebody
// renames mid-quarter is one no report can be compared across.
router.get("/", checkAuth(), requireCompany, DepartmentController.getAll);

router.post(
    "/",
    checkAuth(Role.admin),
    validateRequest(createDepartmentZodSchema),
    DepartmentController.create
);
router.patch(
    "/:id",
    checkAuth(Role.admin),
    validateRequest(updateDepartmentZodSchema),
    DepartmentController.update
);
router.delete("/:id", checkAuth(Role.admin), DepartmentController.remove);

export const DepartmentRoutes = router;
