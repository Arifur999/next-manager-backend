import { Router } from "express";
import { Role } from "../../../generated/prisma/enums.js";
import { checkAuth } from "../../middleware/checkAuth.js";
import { requireScope } from "../../middleware/requireScope.js";
import { requireCompany } from "../../middleware/requireCompany.js";
import { validateRequest } from "../../middleware/validateRequest.js";
import { TimeEntryController } from "./timeEntry.controller.js";
import { createTimeEntryZodSchema, setCapacityZodSchema, updateTimeEntryZodSchema, timeEntryListQueryZodSchema, timeSummaryQueryZodSchema } from "./timeEntry.validation.js";
import { idParams, userIdParams } from "../../shared/requestSchemas.js";
import { listQuerySchema } from "../../shared/listQuery.js";

const router = Router();

// Logging time is the whole job for operations, so the write routes are open to
// every signed-in user. The service - not the gate - is what keeps operations
// to their own rows: their id is applied to the where clause, so somebody
// else's entry reads as "not found" rather than as a refusal.
router.get("/", checkAuth(), requireCompany, validateRequest({ query: timeEntryListQueryZodSchema }), TimeEntryController.getAllEntries);
router.get("/summary", checkAuth(), requireCompany, validateRequest({ query: timeSummaryQueryZodSchema }), TimeEntryController.getSummary);
router.post("/", checkAuth(), requireCompany, requireScope("time", "create"), validateRequest(createTimeEntryZodSchema), TimeEntryController.createEntry);
router.patch("/:id", checkAuth(), requireCompany, requireScope("time", "edit"), validateRequest({ params: idParams, body: updateTimeEntryZodSchema }), TimeEntryController.updateEntry);
router.delete("/:id", checkAuth(), requireCompany, validateRequest({ params: idParams }), TimeEntryController.deleteEntry);

// Capacity is the denominator of every utilization figure, so it stays with the
// people who own the team and the reporting. Workload and Availability read one
// endpoint, so the two screens cannot disagree about a week.
router.get("/workload", checkAuth(Role.admin, Role.project_manager), validateRequest({ query: listQuerySchema }), TimeEntryController.getWorkload);
router.get("/capacity", checkAuth(Role.admin, Role.project_manager), TimeEntryController.getCapacities);
router.patch("/capacity/:userId", checkAuth(Role.admin, Role.project_manager), validateRequest({ params: userIdParams, body: setCapacityZodSchema }), TimeEntryController.setCapacity);

// Approval is what turns logged time into billable time, so it is a second
// person's job by definition - the service also refuses self-approval.
router.post("/:id/approve", checkAuth(Role.admin, Role.project_manager), requireScope("time", "edit"), validateRequest({ params: idParams }), TimeEntryController.approveEntry);
router.post("/:id/unapprove", checkAuth(Role.admin, Role.project_manager), requireScope("time", "edit"), validateRequest({ params: idParams }), TimeEntryController.unapproveEntry);

export const TimeEntryRoutes = router;
