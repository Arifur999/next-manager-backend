import { Request, Response } from "express";
import status from "http-status";
import { LeaveStatus } from "../../../generated/prisma/enums.js";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import catchAsync from "../../shared/catchAsync.js";
import { sendResponse } from "../../shared/sendResponse.js";
import { AttendanceService } from "./attendance.service.js";
import { LeaveService } from "./leave.service.js";
import { PayrollService } from "./payroll.service.js";

const ok = (res: Response, message: string, data: unknown, httpStatus: number = status.OK) =>
    sendResponse(res, { success: true, httpStatus, message, data });

const q = (req: Request) => req.query as Record<string, unknown>;
const str = (value: unknown) => (typeof value === "string" ? value : undefined);

// ---------------------------------------------------------------- attendance

const getAttendance = catchAsync(async (req: Request, res: Response) => {
    const query = q(req);
    const result = await AttendanceService.getAll(req.user as IRequestUser, {
        from: str(query.from),
        to: str(query.to),
        userId: str(query.user_id),
    });
    ok(res, "Attendance retrieved successfully", result);
});

const clock = catchAsync(async (req: Request, res: Response) => {
    const result = await AttendanceService.clock(req.user as IRequestUser);
    ok(res, result.check_out ? "Checked out" : "Checked in", result);
});

const recordAttendance = catchAsync(async (req: Request, res: Response) => {
    const result = await AttendanceService.record(req.body, req.user as IRequestUser);
    ok(res, "Attendance recorded successfully", result);
});

// ---------------------------------------------------------------- leave

const getLeaveTypes = catchAsync(async (req: Request, res: Response) => {
    const result = await LeaveService.getTypes(req.user as IRequestUser);
    ok(res, "Leave types retrieved successfully", result);
});

const createLeaveType = catchAsync(async (req: Request, res: Response) => {
    const result = await LeaveService.createType(req.body, req.user as IRequestUser);
    ok(res, "Leave type added successfully", result, status.CREATED);
});

const updateLeaveType = catchAsync(async (req: Request, res: Response) => {
    const result = await LeaveService.updateType(
        req.params.id as string,
        req.body,
        req.user as IRequestUser
    );
    ok(res, "Leave type updated successfully", result);
});

const getLeaveRequests = catchAsync(async (req: Request, res: Response) => {
    const query = q(req);
    const raw = str(query.status);

    const result = await LeaveService.getRequests(req.user as IRequestUser, {
        // An unknown status shows everything rather than an error page.
        status: raw && raw in LeaveStatus ? (raw as LeaveStatus) : undefined,
        userId: str(query.user_id),
        mine: query.mine === "true",
    });
    ok(res, "Leave requests retrieved successfully", result);
});

const getLeaveBalance = catchAsync(async (req: Request, res: Response) => {
    const query = q(req);
    const user = req.user as IRequestUser;

    const result = await LeaveService.getBalance(
        user,
        // Somebody else's balance is a management view; asking for it without
        // the roles to read it is handled by the route, not here.
        str(query.user_id) ?? user.userId,
        Number(str(query.year)) || new Date().getUTCFullYear()
    );
    ok(res, "Leave balance retrieved successfully", result);
});

const requestLeave = catchAsync(async (req: Request, res: Response) => {
    const result = await LeaveService.request(req.body, req.user as IRequestUser);
    ok(res, "Leave requested successfully", result, status.CREATED);
});

const cancelLeave = catchAsync(async (req: Request, res: Response) => {
    const result = await LeaveService.cancel(req.params.id as string, req.user as IRequestUser);
    ok(res, "Request withdrawn", result);
});

const decideLeave = catchAsync(async (req: Request, res: Response) => {
    const result = await LeaveService.decide(
        req.params.id as string,
        req.body,
        req.user as IRequestUser
    );
    ok(res, req.body.approve ? "Leave approved" : "Leave turned down", result);
});

// ---------------------------------------------------------------- payroll

const getPayrollRuns = catchAsync(async (req: Request, res: Response) => {
    const result = await PayrollService.getRuns(req.user as IRequestUser);
    ok(res, "Payroll runs retrieved successfully", result);
});

const createPayrollRun = catchAsync(async (req: Request, res: Response) => {
    const result = await PayrollService.createRun(req.body, req.user as IRequestUser);
    ok(res, "Payroll opened successfully", result, status.CREATED);
});

const setPayrollItems = catchAsync(async (req: Request, res: Response) => {
    const result = await PayrollService.setItems(
        req.params.id as string,
        req.body,
        req.user as IRequestUser
    );
    ok(res, "Payroll saved successfully", result);
});

const completePayroll = catchAsync(async (req: Request, res: Response) => {
    const result = await PayrollService.complete(
        req.params.id as string,
        req.body,
        req.user as IRequestUser
    );
    // Says what actually happened to the money, because this is the one action
    // in the module that moves any.
    const paid = result.items.filter((item) => item.payout_id).length;
    ok(res, `Paid ${paid} ${paid === 1 ? "salary" : "salaries"}`, result);
});

const deletePayrollRun = catchAsync(async (req: Request, res: Response) => {
    const result = await PayrollService.removeRun(
        req.params.id as string,
        req.user as IRequestUser
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
