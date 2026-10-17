import { Request, Response } from "express";
import status from "http-status";
import catchAsync from "../../shared/catchAsync.js";
import { sendResponse } from "../../shared/sendResponse.js";
import { AttendanceService } from "./attendance.service.js";
import { LeaveService } from "./leave.service.js";
import { PayrollService } from "./payroll.service.js";
import { idOf, queryOf } from "../../shared/requestSchemas.js";
import { requireUser } from "../../shared/requireUser.js";
import { attendanceListQueryZodSchema, leaveBalanceQueryZodSchema, leaveListQueryZodSchema } from "./hr.validation.js";

const ok = (res: Response, message: string, data: unknown, httpStatus: number = status.OK) =>
    sendResponse(res, { success: true, httpStatus, message, data });

// ---------------------------------------------------------------- attendance

const getAttendance = catchAsync(async (req: Request, res: Response) => {
    const query = queryOf(req, attendanceListQueryZodSchema);
    const result = await AttendanceService.getAll(requireUser(req), {
        from: query.from,
        to: query.to,
        userId: query.user_id,
    });
    ok(res, "Attendance retrieved successfully", result);
});

const clock = catchAsync(async (req: Request, res: Response) => {
    const result = await AttendanceService.clock(requireUser(req));
    ok(res, result.check_out ? "Checked out" : "Checked in", result);
});

const recordAttendance = catchAsync(async (req: Request, res: Response) => {
    const result = await AttendanceService.record(req.body, requireUser(req));
    ok(res, "Attendance recorded successfully", result);
});

// ---------------------------------------------------------------- leave

const getLeaveTypes = catchAsync(async (req: Request, res: Response) => {
    const result = await LeaveService.getTypes(requireUser(req));
    ok(res, "Leave types retrieved successfully", result);
});

const createLeaveType = catchAsync(async (req: Request, res: Response) => {
    const result = await LeaveService.createType(req.body, requireUser(req));
    ok(res, "Leave type added successfully", result, status.CREATED);
});

const updateLeaveType = catchAsync(async (req: Request, res: Response) => {
    const result = await LeaveService.updateType(
        idOf(req),
        req.body,
        requireUser(req)
    );
    ok(res, "Leave type updated successfully", result);
});

const getLeaveRequests = catchAsync(async (req: Request, res: Response) => {
    const query = queryOf(req, leaveListQueryZodSchema);
    const result = await LeaveService.getRequests(requireUser(req), {
        status: query.status,
        userId: query.user_id,
        mine: query.mine,
    });
    ok(res, "Leave requests retrieved successfully", result);
});

const getLeaveBalance = catchAsync(async (req: Request, res: Response) => {
    const query = queryOf(req, leaveBalanceQueryZodSchema);
    const result = await LeaveService.getBalance(
        requireUser(req),
        query.user_id,
        query.year ?? new Date().getUTCFullYear()
    );
    ok(res, "Leave balance retrieved successfully", result);
});

const requestLeave = catchAsync(async (req: Request, res: Response) => {
    const result = await LeaveService.request(req.body, requireUser(req));
    ok(res, "Leave requested successfully", result, status.CREATED);
});

const cancelLeave = catchAsync(async (req: Request, res: Response) => {
    const result = await LeaveService.cancel(idOf(req), requireUser(req));
    ok(res, "Request withdrawn", result);
});

const decideLeave = catchAsync(async (req: Request, res: Response) => {
    const result = await LeaveService.decide(
        idOf(req),
        req.body,
        requireUser(req)
    );
    ok(res, req.body.approve ? "Leave approved" : "Leave turned down", result);
});

// ---------------------------------------------------------------- payroll

const getPayrollRuns = catchAsync(async (req: Request, res: Response) => {
    const result = await PayrollService.getRuns(requireUser(req));
    ok(res, "Payroll runs retrieved successfully", result);
});

const createPayrollRun = catchAsync(async (req: Request, res: Response) => {
    const result = await PayrollService.createRun(req.body, requireUser(req));
    ok(res, "Payroll opened successfully", result, status.CREATED);
});

const setPayrollItems = catchAsync(async (req: Request, res: Response) => {
    const result = await PayrollService.setItems(
        idOf(req),
        req.body,
        requireUser(req)
    );
    ok(res, "Payroll saved successfully", result);
});

const completePayroll = catchAsync(async (req: Request, res: Response) => {
    const result = await PayrollService.complete(
        idOf(req),
        req.body,
        requireUser(req)
    );
    // Says what actually happened to the money, because this is the one action
    // in the module that moves any.
    const paid = result.items.filter((item) => item.payout_id).length;
    ok(res, `Paid ${paid} ${paid === 1 ? "salary" : "salaries"}`, result);
});

const deletePayrollRun = catchAsync(async (req: Request, res: Response) => {
    const result = await PayrollService.removeRun(
        idOf(req),
        requireUser(req)
    );
    ok(res, "Draft payroll discarded", result);
});

export const HrController = {
    getAttendance,
    clock,
    recordAttendance,
    getLeaveTypes,
    createLeaveType,
    updateLeaveType,
    getLeaveRequests,
    getLeaveBalance,
    requestLeave,
    cancelLeave,
    decideLeave,
    getPayrollRuns,
    createPayrollRun,
    setPayrollItems,
    completePayroll,
    deletePayrollRun,
};
