import { Router } from "express";
import { Role } from "../../../generated/prisma/enums.js";
import { checkAuth } from "../../middleware/checkAuth.js";
import { requireCompany } from "../../middleware/requireCompany.js";
import { validateRequest } from "../../middleware/validateRequest.js";
import { ProjectController } from "./project.controller.js";
import {
    createProjectZodSchema,
    setBaselineZodSchema,
    updateProjectZodSchema,
} from "./project.validation.js";

const router = Router();

// Operations can see the projects they work on, so the read routes are open to
// every signed-in user - but the money on them is not.
router.get("/", checkAuth(), requireCompany, ProjectController.getAllProjects);
router.get("/:id", checkAuth(), requireCompany, ProjectController.getSingleProject);
router.get("/:id/financials", checkAuth(Role.admin, Role.project_manager), ProjectController.getProjectFinancials);
router.post("/", checkAuth(Role.admin, Role.sales, Role.project_manager), validateRequest(createProjectZodSchema), ProjectController.createProject);
router.patch("/:id", checkAuth(Role.admin, Role.project_manager), validateRequest(updateProjectZodSchema), ProjectController.updateProject);
// Freezing the plan is the project manager's act - it is the moment the
// schedule stops being a proposal. Sales cannot do it: a baseline set by the
// person who sold the work is not an independent record of what was sold.
router.post(
    "/:id/baseline",
    checkAuth(Role.admin, Role.project_manager),
    validateRequest(setBaselineZodSchema),
    ProjectController.setBaseline
);

router.delete("/:id", checkAuth(Role.admin), ProjectController.deleteProject);

export const ProjectRoutes = router;
