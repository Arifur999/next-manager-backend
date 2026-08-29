import { Request, Response } from "express";
import status from "http-status";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import catchAsync from "../../shared/catchAsync.js";
import { sendResponse } from "../../shared/sendResponse.js";
import { AnnouncementService } from "./announcement.service.js";

const getAnnouncements = catchAsync(async (_req: Request, res: Response) => {
    const result = await AnnouncementService.getAnnouncements();
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Announcements retrieved successfully",
        data: result,
    });
});

const createAnnouncement = catchAsync(async (req: Request, res: Response) => {
    const result = await AnnouncementService.createAnnouncement(req.user as IRequestUser, req.body);
    sendResponse(res, {
        success: true,
        httpStatus: status.CREATED,
        message: "Draft saved successfully",
        data: result,
    });
});

const updateAnnouncement = catchAsync(async (req: Request, res: Response) => {
    const result = await AnnouncementService.updateAnnouncement(
        req.user as IRequestUser,
        req.params.id as string,
        req.body
    );
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Draft updated successfully",
        data: result,
    });
});

/**
 * The message says what actually happened to the email, rather than assuming
 * it went out. An operator who is told "published" and later finds nobody was
 * mailed has been misled by their own tool.
 */
const publishAnnouncement = catchAsync(async (req: Request, res: Response) => {
    const result = await AnnouncementService.publishAnnouncement(req.user as IRequestUser, req.params.id as string);

    const message = !result.email
        ? "Published successfully"
        : result.email.delivered === result.email.attempted
          ? `Published, and emailed to ${result.email.delivered} of your customers`
          : `Published, but the email reached ${result.email.delivered} of ${result.email.attempted} addresses`;

    sendResponse(res, { success: true, httpStatus: status.OK, message, data: result });
});

const deleteAnnouncement = catchAsync(async (req: Request, res: Response) => {
    const result = await AnnouncementService.deleteAnnouncement(req.user as IRequestUser, req.params.id as string);
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Announcement removed successfully",
        data: result,
    });
});

// ---------------------------------------------------------------- customer

const getMyAnnouncements = catchAsync(async (req: Request, res: Response) => {
    const result = await AnnouncementService.getMyAnnouncements(req.user as IRequestUser);
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Notifications retrieved successfully",
        data: result,
    });
});

const getUnreadCount = catchAsync(async (req: Request, res: Response) => {
    const result = await AnnouncementService.getUnreadCount(req.user as IRequestUser);
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Unread count retrieved successfully",
        data: result,
    });
});

const markRead = catchAsync(async (req: Request, res: Response) => {
    const result = await AnnouncementService.markRead(req.user as IRequestUser, req.params.id as string);
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "Marked as read",
        data: result,
    });
});

const markAllRead = catchAsync(async (req: Request, res: Response) => {
    const result = await AnnouncementService.markAllRead(req.user as IRequestUser);
    sendResponse(res, {
        success: true,
        httpStatus: status.OK,
        message: "All marked as read",
        data: result,
    });
});

export const AnnouncementController = {
    getAnnouncements,
    createAnnouncement,
    updateAnnouncement,
    publishAnnouncement,
    deleteAnnouncement,
    getMyAnnouncements,
    getUnreadCount,
    markRead,
    markAllRead,
};
