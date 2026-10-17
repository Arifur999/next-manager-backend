import { Router } from "express";
import { Role } from "../../../generated/prisma/enums.js";
import { checkAuth } from "../../middleware/checkAuth.js";
import { requireScope } from "../../middleware/requireScope.js";
import { requireCompany } from "../../middleware/requireCompany.js";
import { validateRequest } from "../../middleware/validateRequest.js";
import { ProjectController } from "./project.controller.js";
import {
    createProjectZodSchema,
    projectListQueryZodSchema,
    setBaselineZodSchema,
    updateProjectZodSchema,
} from "./project.validation.js";
import { idParams } from "../../shared/requestSchemas.js";

const router = Router();

// Operations can see the projects they work on, so the read routes are open to
// every signed-in user - but the money on them is not.
router.get("/", checkAuth(), requireCompany, validateRequest({ query: projectListQueryZodSchema }), ProjectController.getAllProjects);
router.get("/:id", checkAuth(), requireCompany, validateRequest({ params: idParams }), ProjectController.getSingleProject);
router.get("/:id/financials", checkAuth(Role.admin, Role.project_manager), validateRequest({ params: idParams }), ProjectController.getProjectFinancials);
router.post("/", checkAuth(Role.admin, Role.sales, Role.project_manager), requireScope("projects", "create"), validateRequest(createProjectZodSchema), ProjectController.createProject);
router.patch("/:id", checkAuth(Role.admin, Role.project_manager), requireScope("projects", "edit"), validateRequest({ params: idParams, body: updateProjectZodSchema }), ProjectController.updateProject);
// Freezing the plan is the project manager's act - it is the moment the
// schedule stops being a proposal. Sales cannot do it: a baseline set by the
// person who sold the work is not an independent record of what was sold.
router.post(
    "/:id/baseline",
    checkAuth(Role.admin, Role.project_manager),
    validateRequest({ params: idParams, body: setBaselineZodSchema }),
    ProjectController.setBaseline
);

router.delete("/:id", checkAuth(Role.admin), validateRequest({ params: idParams }), ProjectController.deleteProject);

export const ProjectRoutes = router;
