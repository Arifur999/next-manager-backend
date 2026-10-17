import { Router } from "express";
import { Role } from "../../../generated/prisma/enums.js";
import { checkAuth } from "../../middleware/checkAuth.js";
import { requireScope } from "../../middleware/requireScope.js";
import { requireCompany } from "../../middleware/requireCompany.js";
import { validateRequest, validateRequestBy } from "../../middleware/validateRequest.js";
import { TaskController } from "./task.controller.js";
import { createTaskZodSchema, taskUpdateSchemaFor, taskListQueryZodSchema } from "./task.validation.js";
import { idParams } from "../../shared/requestSchemas.js";
import { listQuerySchema } from "../../shared/listQuery.js";

const router = Router();

// The board, counted. Open to everybody the board is open to, and read through
// the same visibility scope, so a report never shows work the caller could not open.
router.get("/report", checkAuth(), requireCompany, validateRequest({ query: listQuerySchema }), TaskController.getReport);

// Open to every signed-in user: the service narrows operations to their own
// tasks, so "My Tasks" and the project board are one endpoint. ?mine,
// ?project_id, ?assignee_id and ?status narrow further.
router.get("/", checkAuth(), requireCompany, validateRequest({ query: taskListQueryZodSchema }), TaskController.getAllTasks);

// Operations may edit only status and description (taskUpdateSchemaFor). Sales
// is left out on purpose: they read the board, and moving a task along is
// controlling the work.
router.patch(
    "/:id",
    checkAuth(Role.admin, Role.project_manager, Role.operations),
    requireCompany,
    requireScope("tasks", "edit"),
    validateRequestBy(taskUpdateSchemaFor),
    validateRequest({ params: idParams }),
    TaskController.updateTask
);

router.post("/", checkAuth(Role.admin, Role.project_manager), requireScope("tasks", "create"), validateRequest(createTaskZodSchema), TaskController.createTask);
router.delete("/:id", checkAuth(Role.admin, Role.project_manager), requireScope("tasks", "delete"), validateRequest({ params: idParams }), TaskController.deleteTask);

export const TaskRoutes = router;
