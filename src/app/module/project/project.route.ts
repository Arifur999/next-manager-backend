import { Router } from "express";
import { Role } from "../../../generated/prisma/enums.js";
import { checkAuth } from "../../middleware/checkAuth.js";
import { validateRequest } from "../../middleware/validateRequest.js";
import { ProjectController } from "./project.controller.js";
import { createProjectZodSchema, updateProjectZodSchema } from "./project.validation.js";

const router = Router();

// A member can see the projects they work on, so the read routes are open to
// every signed-in user - but the money on them is not.
router.get("/", checkAuth(), ProjectController.getAllProjects);
router.get("/:id", checkAuth(), ProjectController.getSingleProject);
router.get("/:id/financials", checkAuth(Role.owner, Role.admin, Role.manager), ProjectController.getProjectFinancials);
router.post("/", checkAuth(Role.owner, Role.admin, Role.manager), validateRequest(createProjectZodSchema), ProjectController.createProject);
router.patch("/:id", checkAuth(Role.owner, Role.admin, Role.manager), validateRequest(updateProjectZodSchema), ProjectController.updateProject);
router.delete("/:id", checkAuth(Role.owner, Role.admin), ProjectController.deleteProject);

export const ProjectRoutes = router;
