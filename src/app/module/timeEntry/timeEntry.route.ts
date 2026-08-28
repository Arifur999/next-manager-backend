import { Router } from "express";
import { Role } from "../../../generated/prisma/enums.js";
import { checkAuth } from "../../middleware/checkAuth.js";
import { validateRequest } from "../../middleware/validateRequest.js";
import { TimeEntryController } from "./timeEntry.controller.js";
import { createTimeEntryZodSchema, setCapacityZodSchema, updateTimeEntryZodSchema } from "./timeEntry.validation.js";

const router = Router();

// Logging time is the whole job for operations, so the write routes are open to
// every signed-in user. The service - not the gate - is what keeps operations
// to their own rows: their id is applied to the where clause, so somebody
// else's entry reads as "not found" rather than as a refusal.
router.get("/", checkAuth(), TimeEntryController.getAllEntries);
router.get("/summary", checkAuth(), TimeEntryController.getSummary);
router.post("/", checkAuth(), validateRequest(createTimeEntryZodSchema), TimeEntryController.createEntry);
router.patch("/:id", checkAuth(), validateRequest(updateTimeEntryZodSchema), TimeEntryController.updateEntry);
router.delete("/:id", checkAuth(), TimeEntryController.deleteEntry);

// Capacity is the denominator every utilization figure divides by, so changing
// it moves every one of those numbers. That belongs with the people who own
// the team and the reporting.
router.get("/capacity", checkAuth(Role.admin, Role.project_manager), TimeEntryController.getCapacities);
router.patch("/capacity/:userId", checkAuth(Role.admin, Role.project_manager), validateRequest(setCapacityZodSchema), TimeEntryController.setCapacity);

// Approval is what turns logged time into billable time, so it is a second
// person's job by definition - the service also refuses self-approval.
router.post("/:id/approve", checkAuth(Role.admin, Role.project_manager), TimeEntryController.approveEntry);
router.post("/:id/unapprove", checkAuth(Role.admin, Role.project_manager), TimeEntryController.unapproveEntry);

export const TimeEntryRoutes = router;
