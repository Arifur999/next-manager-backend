import { Router } from "express";
import { Role } from "../../../generated/prisma/enums.js";
import { checkAuth } from "../../middleware/checkAuth.js";
import { requirePermission } from "../../middleware/requirePermission.js";
import { requireCompany } from "../../middleware/requireCompany.js";
import { validateRequest, validateRequestBy } from "../../middleware/validateRequest.js";
import { TaskController } from "./task.controller.js";
import { createTaskZodSchema, taskUpdateSchemaFor } from "./task.validation.js";

const router = Router();

// Open to every signed-in user: the service narrows operations to their own
// tasks, so "My Tasks" and the project board are one endpoint with a different
// scope rather than two near-identical ones that drift apart.
// ?mine=true, ?project_id=, ?assignee_id=, ?status= all narrow further.
// The board, counted. Declared before any parameter route so the literal path
// is not swallowed. Open to everybody the board is open to, and read through
// the same visibility scope - a report must never show somebody work they
// could not open.
router.get("/report", checkAuth(), requireCompany, TaskController.getReport);

router.get("/", checkAuth(), requireCompany, TaskController.getAllTasks);

// Who may edit a task they can reach, and what "edit" means, depend on who
// they are. Operations gets status and description; the fields that define the
// commitment stay with whoever owns the schedule.
//
// Sales is named OUT of this list on purpose. They read the board to see where
// a client they brought in has got to, and reading is the whole of it - moving
// a task along IS controlling execution. Left as checkAuth() they fell through
// to the full update schema and could have moved a due date, reassigned the
// work, re-prioritised it or pushed it into another project.
router.patch(
    "/:id",
    checkAuth(Role.admin, Role.project_manager, Role.operations),
    requireCompany,
    validateRequestBy(taskUpdateSchemaFor),
    TaskController.updateTask
);

router.post("/", checkAuth(Role.admin, Role.project_manager), requirePermission("tasks.manage"), validateRequest(createTaskZodSchema), TaskController.createTask);
router.delete("/:id", checkAuth(Role.admin, Role.project_manager), requirePermission("tasks.manage"), TaskController.deleteTask);

export const TaskRoutes = router;
