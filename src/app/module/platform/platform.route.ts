import { Router } from "express";
import { Role } from "../../../generated/prisma/enums.js";
import { checkAuth } from "../../middleware/checkAuth.js";
import { requirePermission } from "../../middleware/requirePermission.js";
import { validateRequest } from "../../middleware/validateRequest.js";
import { authRateLimit } from "../../middleware/rateLimit.js";
import { AgencyInviteController } from "./agencyInvite.controller.js";
import { AnnouncementController } from "./announcement.controller.js";
import { PlatformController } from "./platform.controller.js";
import { PlatformFinanceController } from "./platformFinance.controller.js";
import { PlatformInviteController } from "./platformInvite.controller.js";
import { PlatformSettingsController } from "./platformSettings.controller.js";
import {
    acceptAgencyInviteZodSchema,
    acceptPlatformInviteZodSchema,
    createAgencyInviteZodSchema,
    createAnnouncementZodSchema,
    createCompanyZodSchema,
    createPlatformExpenseZodSchema,
    createPlatformInviteZodSchema,
    createPlanZodSchema,
    setPlatformPermissionsZodSchema,
    setSubscriptionZodSchema,
    updateAnnouncementZodSchema,
    updatePlanZodSchema,
    updatePlatformSettingsZodSchema,
    updatePlatformExpenseZodSchema,
} from "./platform.validation.js";

const router = Router();

// A company's own standing. Readable by anyone signed in, because "you are out
// of seats" is a message a project manager can hit and it is useless without
// being able to look up the limit.
//
// Note this route is NOT behind checkSubscription: a suspended company has to
// be able to see why it is suspended.
router.get("/subscription", checkAuth(), PlatformController.getMySubscription);

// Everything below is the platform's own console.
router.get(
    "/plans",
    checkAuth(Role.super_admin),
    requirePermission("platform.companies.view"),
    PlatformController.getPlans
);
router.post(
    "/plans",
    checkAuth(Role.super_admin),
    requirePermission("platform.plans.manage"),
    validateRequest(createPlanZodSchema),
    PlatformController.createPlan
);
router.patch(
    "/plans/:id",
    checkAuth(Role.super_admin),
    requirePermission("platform.plans.manage"),
    validateRequest(updatePlanZodSchema),
    PlatformController.updatePlan
);

// What the operator opens the console to see: how many companies, what they
// pay, and which trials are about to lapse.
router.get(
    "/overview",
    checkAuth(Role.super_admin),
    requirePermission("platform.companies.view"),
    PlatformController.getOverview
);

// What the platform team has been doing. GET only - a history somebody can
// edit answers nothing.
router.get(
    "/activity",
    checkAuth(Role.super_admin),
    requirePermission("platform.companies.view"),
    PlatformController.getActivity
);

router.get(
    "/companies",
    checkAuth(Role.super_admin),
    requirePermission("platform.companies.view"),
    PlatformController.getCompanies
);

// Provisioning by hand, for a company that agreed a price before it ever saw
// the sign-up form. Creates the workspace, its first admin and its
// subscription together - a workspace nobody can sign in to is not a
// workspace.
router.post(
    "/companies",
    checkAuth(Role.super_admin),
    requirePermission("platform.companies.manage"),
    validateRequest(createCompanyZodSchema),
    PlatformController.createCompany
);
router.patch(
    "/companies/:organizationId/subscription",
    checkAuth(Role.super_admin),
    requirePermission("platform.companies.manage"),
    validateRequest(setSubscriptionZodSchema),
    PlatformController.setSubscription
);

// The platform team. Managing it is its own permission, and it is the one that
// can grant every other - including itself.
router.get(
    "/admins",
    checkAuth(Role.super_admin),
    requirePermission("platform.admins.manage"),
    PlatformController.getAdmins
);
router.patch(
    "/admins/:id/permissions",
    checkAuth(Role.super_admin),
    requirePermission("platform.admins.manage"),
    validateRequest(setPlatformPermissionsZodSchema),
    PlatformController.setPermissions
);

// Growing the team. Every one of these is behind platform.admins.manage - the
// permission that can grant every other, including itself.
router.get(
    "/invites",
    checkAuth(Role.super_admin),
    requirePermission("platform.admins.manage"),
    PlatformInviteController.getInvites
);
router.post(
    "/invites",
    checkAuth(Role.super_admin),
    requirePermission("platform.admins.manage"),
    validateRequest(createPlatformInviteZodSchema),
    PlatformInviteController.createInvite
);
router.delete(
    "/invites/:id",
    checkAuth(Role.super_admin),
    requirePermission("platform.admins.manage"),
    PlatformInviteController.revokeInvite
);

router.post(
    "/admins/:id/approve",
    checkAuth(Role.super_admin),
    requirePermission("platform.admins.manage"),
    PlatformInviteController.approveAdmin
);
router.delete(
    "/admins/:id",
    checkAuth(Role.super_admin),
    requirePermission("platform.admins.manage"),
    PlatformInviteController.removeAdmin
);

// AGENCIO's own books. Reading the numbers and recording what is spent are
// separate permissions: somebody can be shown how the business is doing
// without being able to change what it says.
router.get(
    "/finance",
    checkAuth(Role.super_admin),
    requirePermission("platform.finance.view"),
    PlatformFinanceController.getReport
);
router.get(
    "/trend",
    checkAuth(Role.super_admin),
    requirePermission("platform.companies.view"),
    PlatformFinanceController.getTrend
);
router.get(
    "/expenses",
    checkAuth(Role.super_admin),
    requirePermission("platform.finance.view", "platform.expenses.manage"),
    PlatformFinanceController.getExpenses
);
router.post(
    "/expenses",
    checkAuth(Role.super_admin),
    requirePermission("platform.expenses.manage"),
    validateRequest(createPlatformExpenseZodSchema),
    PlatformFinanceController.createExpense
);
router.patch(
    "/expenses/:id",
    checkAuth(Role.super_admin),
    requirePermission("platform.expenses.manage"),
    validateRequest(updatePlatformExpenseZodSchema),
    PlatformFinanceController.updateExpense
);
router.delete(
    "/expenses/:id",
    checkAuth(Role.super_admin),
    requirePermission("platform.expenses.manage"),
    PlatformFinanceController.deleteExpense
);

// ---------------------------------------------------------------------------
// Announcements
// ---------------------------------------------------------------------------
//
// The console half. Writing a draft and sending it are the same permission,
// because a draft nobody may publish is a document, not a feature.
router.get(
    "/announcements",
    checkAuth(Role.super_admin),
    requirePermission("platform.campaigns.send"),
    AnnouncementController.getAnnouncements
);
router.post(
    "/announcements",
    checkAuth(Role.super_admin),
    requirePermission("platform.campaigns.send"),
    validateRequest(createAnnouncementZodSchema),
    AnnouncementController.createAnnouncement
);
router.patch(
    "/announcements/:id",
    checkAuth(Role.super_admin),
    requirePermission("platform.campaigns.send"),
    validateRequest(updateAnnouncementZodSchema),
    AnnouncementController.updateAnnouncement
);
// Its own endpoint rather than a flag on the edit: this is the one that cannot
// be taken back, and it should not be reachable by a form that autosaves.
router.post(
    "/announcements/:id/publish",
    checkAuth(Role.super_admin),
    requirePermission("platform.campaigns.send"),
    AnnouncementController.publishAnnouncement
);
router.delete(
    "/announcements/:id",
    checkAuth(Role.super_admin),
    requirePermission("platform.campaigns.send"),
    AnnouncementController.deleteAnnouncement
);

// ---------------------------------------------------------------------------
// How this installation is set up
// ---------------------------------------------------------------------------
//
// Its own permission rather than folding into admins.manage: one edit here
// changes what every future customer is put on and what every email this
// server sends, which is a wider blast radius than adding a colleague.
router.get(
    "/settings",
    checkAuth(Role.super_admin),
    requirePermission("platform.settings.manage"),
    PlatformSettingsController.getSettings
);
router.patch(
    "/settings",
    checkAuth(Role.super_admin),
    requirePermission("platform.settings.manage"),
    validateRequest(updatePlatformSettingsZodSchema),
    PlatformSettingsController.updateSettings
);

// ---------------------------------------------------------------------------
// Bringing an agency on
// ---------------------------------------------------------------------------
//
// The console's actual job. Gated by companies.manage, the same permission as
// creating one by hand - this is the same act with the password step handed
// back to the person it belongs to.
router.get(
    "/agency-invites",
    checkAuth(Role.super_admin),
    requirePermission("platform.companies.view"),
    AgencyInviteController.getInvites
);
router.post(
    "/agency-invites",
    checkAuth(Role.super_admin),
    requirePermission("platform.companies.manage"),
    validateRequest(createAgencyInviteZodSchema),
    AgencyInviteController.createInvite
);
router.delete(
    "/agency-invites/:id",
    checkAuth(Role.super_admin),
    requirePermission("platform.companies.manage"),
    AgencyInviteController.revokeInvite
);

export const PlatformRoutes = router;

// ---------------------------------------------------------------------------
// The customer half: the bell.
// ---------------------------------------------------------------------------
//
// `checkAuth()` with no role, because a notice about Sunday maintenance is for
// whoever works on Sunday, not only for whoever pays. Nothing here is scoped to
// an organization - the audience is worked out from the reader's own company -
// so requireCompany would add a way to fail and nothing else.
const notificationRouter = Router();

notificationRouter.get("/", checkAuth(), AnnouncementController.getMyAnnouncements);
// Its own endpoint because the badge is polled: counting by fetching the list
// would pull every body text across the wire to render one number.
notificationRouter.get("/unread-count", checkAuth(), AnnouncementController.getUnreadCount);
notificationRouter.post("/read-all", checkAuth(), AnnouncementController.markAllRead);
notificationRouter.post("/:id/read", checkAuth(), AnnouncementController.markRead);

export const NotificationRoutes = notificationRouter;

// ---------------------------------------------------------------------------
// Public. Whoever opens the link has no account yet.
// ---------------------------------------------------------------------------
//
// Its own token space, separate from the company join routes: the two never
// mix, and a token for one can never be mistaken for the other.
const publicRouter = Router();

publicRouter.get("/:token", authRateLimit, PlatformInviteController.getInviteByToken);
publicRouter.post(
    "/:token/accept",
    authRateLimit,
    validateRequest(acceptPlatformInviteZodSchema),
    PlatformInviteController.acceptInvite
);

export const PublicPlatformInviteRoutes = publicRouter;

// ---------------------------------------------------------------------------
// Public: opening an agency from an invite.
// ---------------------------------------------------------------------------
//
// Its own token space again. A token for one flow can never be mistaken for a
// token for another, which matters most here - these two links produce very
// different accounts.
const agencyRouter = Router();

agencyRouter.get("/:token", authRateLimit, AgencyInviteController.getInviteByToken);
agencyRouter.post(
    "/:token/accept",
    authRateLimit,
    validateRequest(acceptAgencyInviteZodSchema),
    AgencyInviteController.acceptInvite
);

export const PublicAgencyInviteRoutes = agencyRouter;
