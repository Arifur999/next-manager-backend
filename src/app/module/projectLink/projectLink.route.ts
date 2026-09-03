import { Router } from "express";
import { Role } from "../../../generated/prisma/enums.js";
import { checkAuth } from "../../middleware/checkAuth.js";
import { requireCompany } from "../../middleware/requireCompany.js";
import { validateRequest } from "../../middleware/validateRequest.js";
import { ProjectLinkController } from "./projectLink.controller.js";
import {
    createProjectLinkZodSchema,
    updateProjectLinkZodSchema,
} from "./projectLink.validation.js";

const router = Router();

// Readable by everyone signed in - operations needs to open the Figma file it
// is working from. The service scopes it to the projects they are actually on,
// so "everyone" means everyone's own projects.
router.get("/", checkAuth(), requireCompany, ProjectLinkController.getAll);

// Whoever runs the project curates its material. Sales is not on this list:
// they watch a project, they do not set it up - the same line every other write
// behind their Projects page draws.
const curator = [Role.admin, Role.project_manager] as const;

router.post(
    "/",
    checkAuth(...curator),
    validateRequest(createProjectLinkZodSchema),
    ProjectLinkController.create
);
router.patch(
    "/:id",
    checkAuth(...curator),
    validateRequest(updateProjectLinkZodSchema),
    ProjectLinkController.update
);
router.delete("/:id", checkAuth(...curator), ProjectLinkController.remove);

export const ProjectLinkRoutes = router;
