import { Router } from "express";
import { Role } from "../../../generated/prisma/enums.js";
import { checkAuth } from "../../middleware/checkAuth.js";
import { validateRequest } from "../../middleware/validateRequest.js";
import { ProjectMemberController } from "./projectMember.controller.js";
import { assignMemberZodSchema } from "./projectMember.validation.js";

const router = Router();

// Who is on what is not sensitive - everyone benefits from seeing the team
// around them - so the reads are open to everyone signed in.
// /overview before /:projectId so the literal path is not swallowed.
router.get("/overview", checkAuth(), ProjectMemberController.getAssignmentOverview);
router.get("/:projectId", checkAuth(), ProjectMemberController.getProjectMembers);

router.post("/", checkAuth(Role.admin, Role.project_manager), validateRequest(assignMemberZodSchema), ProjectMemberController.assignMember);
router.delete("/:id", checkAuth(Role.admin, Role.project_manager), ProjectMemberController.removeMember);

export const ProjectMemberRoutes = router;
