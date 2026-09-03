import { Router } from "express";
import { Role } from "../../../generated/prisma/enums.js";
import { checkAuth } from "../../middleware/checkAuth.js";
import { requirePermission } from "../../middleware/requirePermission.js";
import { requireCompany } from "../../middleware/requireCompany.js";
import { validateRequest } from "../../middleware/validateRequest.js";
import { TimeEntryController } from "./timeEntry.controller.js";
import { createTimeEntryZodSchema, setCapacityZodSchema, updateTimeEntryZodSchema } from "./timeEntry.validation.js";

const router = Router();

// Logging time is the whole job for operations, so the write routes are open to
// every signed-in user. The service - not the gate - is what keeps operations
// to their own rows: their id is applied to the where clause, so somebody
// else's entry reads as "not found" rather than as a refusal.
router.get("/", checkAuth(), requireCompany, TimeEntryController.getAllEntries);
router.get("/summary", checkAuth(), requireCompany, TimeEntryController.getSummary);
router.post("/", checkAuth(), requireCompany, validateRequest(createTimeEntryZodSchema), TimeEntryController.createEntry);
router.patch("/:id", checkAuth(), requireCompany, validateRequest(updateTimeEntryZodSchema), TimeEntryController.updateEntry);
router.delete("/:id", checkAuth(), requireCompany, TimeEntryController.deleteEntry);

// Capacity is the denominator every utilization figure divides by, so changing
// it moves every one of those numbers. That belongs with the people who own
// the team and the reporting.
// Who is carrying what, and what is left of them. One endpoint behind both
// readings: Workload is the hours side, Availability is the gap side, and
// computing them apart is how two screens end up disagreeing about one
// person's week.
router.get("/workload", checkAuth(Role.admin, Role.project_manager), TimeEntryController.getWorkload);
router.get("/capacity", checkAuth(Role.admin, Role.project_manager), TimeEntryController.getCapacities);
router.patch("/capacity/:userId", checkAuth(Role.admin, Role.project_manager), validateRequest(setCapacityZodSchema), TimeEntryController.setCapacity);

// Approval is what turns logged time into billable time, so it is a second
// person's job by definition - the service also refuses self-approval.
router.post("/:id/approve", checkAuth(Role.admin, Role.project_manager), requirePermission("time.approve"), TimeEntryController.approveEntry);
router.post("/:id/unapprove", checkAuth(Role.admin, Role.project_manager), requirePermission("time.approve"), TimeEntryController.unapproveEntry);

export const TimeEntryRoutes = router;
