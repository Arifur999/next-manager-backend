import { Router } from "express";
import { Role } from "../../../generated/prisma/enums.js";
import { checkAuth } from "../../middleware/checkAuth.js";
import { validateRequest, validateRequestBy } from "../../middleware/validateRequest.js";
import { TaskController } from "./task.controller.js";
import { createTaskZodSchema, taskUpdateSchemaFor } from "./task.validation.js";

const router = Router();

// Open to every signed-in user: the service narrows operations to their own
// tasks, so "My Tasks" and the project board are one endpoint with a different
// scope rather than two near-identical ones that drift apart.
// ?mine=true, ?project_id=, ?assignee_id=, ?status= all narrow further.
router.get("/", checkAuth(), TaskController.getAllTasks);

// Operations can move their own task along but not create or delete work.
// Anyone signed in may edit a task they can reach - and what "edit" means
// depends on who they are. Operations gets status and description; the fields
// that define the commitment stay with whoever owns the schedule.
router.patch("/:id", checkAuth(), validateRequestBy(taskUpdateSchemaFor), TaskController.updateTask);

router.post("/", checkAuth(Role.admin, Role.project_manager), validateRequest(createTaskZodSchema), TaskController.createTask);
router.delete("/:id", checkAuth(Role.admin, Role.project_manager), TaskController.deleteTask);

export const TaskRoutes = router;
