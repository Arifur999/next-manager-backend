import { Router } from "express";
import { Role } from "../../../generated/prisma/enums.js";
import { checkAuth } from "../../middleware/checkAuth.js";
import { requireCompany } from "../../middleware/requireCompany.js";
import { validateRequest } from "../../middleware/validateRequest.js";
import { HrController } from "./hr.controller.js";
import {
    completePayrollZodSchema,
    createLeaveTypeZodSchema,
    createPayrollRunZodSchema,
    decideLeaveZodSchema,
    recordAttendanceZodSchema,
    requestLeaveZodSchema,
    setPayrollItemsZodSchema,
    updateLeaveTypeZodSchema,
} from "./hr.validation.js";

const router = Router();

// Whoever decides somebody can be away. The same pair that approves timesheets,
// because it is the same judgement about the same person's week.
const approver = [Role.admin, Role.project_manager] as const;

// ---------------------------------------------------------------- attendance
//
// Everybody clocks themselves in, and everybody can read attendance - but the
// service narrows operations to their own rows. Being able to read when every
// colleague arrived is a management view, and handing it to the whole company
// turns a working record into something people manage their behaviour around.
router.get("/attendance", checkAuth(), requireCompany, HrController.getAttendance);
router.post("/attendance/clock", checkAuth(), requireCompany, HrController.clock);

// Writing somebody else's day is a different claim from clocking your own, and
// is recorded as such.
router.post(
    "/attendance",
    checkAuth(...approver),
    validateRequest(recordAttendanceZodSchema),
    HrController.recordAttendance
);

// ---------------------------------------------------------------- leave

// The list of kinds is a picker for everybody and a decision for admin.
router.get("/leave-types", checkAuth(), requireCompany, HrController.getLeaveTypes);
router.post(
    "/leave-types",
    checkAuth(Role.admin),
    validateRequest(createLeaveTypeZodSchema),
    HrController.createLeaveType
);
router.patch(
    "/leave-types/:id",
    checkAuth(Role.admin),
    validateRequest(updateLeaveTypeZodSchema),
    HrController.updateLeaveType
);

router.get("/leave", checkAuth(), requireCompany, HrController.getLeaveRequests);
// Somebody else's balance is a management view; your own is always readable,
// and the service defaults to the caller when no id is given.
router.get("/leave/balance", checkAuth(), requireCompany, HrController.getLeaveBalance);
router.post(
    "/leave",
    checkAuth(),
    requireCompany,
    validateRequest(requestLeaveZodSchema),
    HrController.requestLeave
);
router.post("/leave/:id/cancel", checkAuth(), requireCompany, HrController.cancelLeave);
router.post(
    "/leave/:id/decide",
    checkAuth(...approver),
    validateRequest(decideLeaveZodSchema),
    HrController.decideLeave
);

// ---------------------------------------------------------------- payroll
//
// Admin alone, all of it. Payroll is every colleague's salary on one screen -
// the single most sensitive list in the product - and completing a run moves
// money out of a company account.
router.get("/payroll", checkAuth(Role.admin), requireCompany, HrController.getPayrollRuns);
router.post(
    "/payroll",
    checkAuth(Role.admin),
    validateRequest(createPayrollRunZodSchema),
    HrController.createPayrollRun
);
router.patch(
    "/payroll/:id/items",
    checkAuth(Role.admin),
    validateRequest(setPayrollItemsZodSchema),
    HrController.setPayrollItems
);
router.post(
    "/payroll/:id/complete",
    checkAuth(Role.admin),
    validateRequest(completePayrollZodSchema),
    HrController.completePayroll
);
router.delete("/payroll/:id", checkAuth(Role.admin), HrController.deletePayrollRun);

export const HrRoutes = router;
