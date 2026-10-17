import { Router } from "express";
import { Role } from "../../../generated/prisma/enums.js";
import { checkAuth } from "../../middleware/checkAuth.js";
import { requirePermission } from "../../middleware/requirePermission.js";
import { validateRequest } from "../../middleware/validateRequest.js";
import { AgencyInviteRoutes } from "./agencyInvite.route.js";
import { AnnouncementController } from "./announcement.controller.js";
import { PlatformController } from "./platform.controller.js";
import { PlatformFinanceController } from "./platformFinance.controller.js";
import { PlatformInviteRoutes } from "./platformInvite.route.js";
import { PlatformSettingsController } from "./platformSettings.controller.js";
import { createAnnouncementZodSchema, createCompanyZodSchema, createPlatformExpenseZodSchema, createPlanZodSchema, setPlatformPermissionsZodSchema, setSubscriptionZodSchema, updateAnnouncementZodSchema, updatePlanZodSchema, updatePlatformSettingsZodSchema, updatePlatformExpenseZodSchema, companyListQueryZodSchema, platformActivityQueryZodSchema, platformTrendQueryZodSchema } from "./platform.validation.js";
import { idParams, organizationIdParams } from "../../shared/requestSchemas.js";
import { listQuerySchema } from "../../shared/listQuery.js";

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
    validateRequest({ params: idParams, body: updatePlanZodSchema }),
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
    validateRequest({ query: platformActivityQueryZodSchema }),
    PlatformController.getActivity
);

router.get(
    "/companies",
    checkAuth(Role.super_admin),
    requirePermission("platform.companies.view"),
    validateRequest({ query: companyListQueryZodSchema }),
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
    validateRequest({ params: organizationIdParams, body: setSubscriptionZodSchema }),
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
    validateRequest({ params: idParams, body: setPlatformPermissionsZodSchema }),
    PlatformController.setPermissions
);

router.use(PlatformInviteRoutes);

// AGENCIO's own books. Reading the numbers and recording what is spent are
// separate permissions: somebody can be shown how the business is doing
// without being able to change what it says.
router.get(
    "/finance",
    checkAuth(Role.super_admin),
    requirePermission("platform.finance.view"),
    validateRequest({ query: listQuerySchema }),
    PlatformFinanceController.getReport
);
router.get(
    "/trend",
    checkAuth(Role.super_admin),
    requirePermission("platform.companies.view"),
    validateRequest({ query: platformTrendQueryZodSchema }),
    PlatformFinanceController.getTrend
);
router.get(
    "/expenses",
    checkAuth(Role.super_admin),
    requirePermission("platform.finance.view", "platform.expenses.manage"),
    validateRequest({ query: listQuerySchema }),
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
    validateRequest({ params: idParams, body: updatePlatformExpenseZodSchema }),
    PlatformFinanceController.updateExpense
);
router.delete(
    "/expenses/:id",
    checkAuth(Role.super_admin),
    requirePermission("platform.expenses.manage"),
    validateRequest({ params: idParams }),
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
    validateRequest({ params: idParams, body: updateAnnouncementZodSchema }),
    AnnouncementController.updateAnnouncement
);
// Its own endpoint rather than a flag on the edit: this is the one that cannot
// be taken back, and it should not be reachable by a form that autosaves.
router.post(
    "/announcements/:id/publish",
    checkAuth(Role.super_admin),
    requirePermission("platform.campaigns.send"),
    validateRequest({ params: idParams }),
    AnnouncementController.publishAnnouncement
);
router.delete(
    "/announcements/:id",
    checkAuth(Role.super_admin),
    requirePermission("platform.campaigns.send"),
    validateRequest({ params: idParams }),
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

router.use(AgencyInviteRoutes);

export const PlatformRoutes = router;
