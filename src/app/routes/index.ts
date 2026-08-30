import { Router } from "express";
import { AccountRoutes } from "../module/account/account.route.js";
import { ActivityRoutes } from "../module/activity/activity.route.js";
import { AuthRoutes } from "../module/auth/auth.route.js";
import { ClientLinkRoutes } from "../module/clientLink/clientLink.route.js";
import { ClientRoutes } from "../module/client/client.route.js";
import { DashboardRoutes } from "../module/dashboard/dashboard.route.js";
import { DepartmentRoutes } from "../module/department/department.route.js";
import { DuePaymentRoutes } from "../module/duePayment/duePayment.route.js";
import { ExchangeRoutes } from "../module/exchange/exchange.route.js";
import { ExpenseRoutes } from "../module/expense/expense.route.js";
import { ExpenseCategoryRoutes } from "../module/expenseCategory/expenseCategory.route.js";
import { InvoiceRoutes } from "../module/invoice/invoice.route.js";
import { InviteRoutes, PublicInviteRoutes } from "../module/invite/invite.route.js";
import { KpiRoutes } from "../module/kpi/kpi.route.js";
import { KpiTargetRoutes } from "../module/kpiTarget/kpiTarget.route.js";
import { LeadSourceRoutes } from "../module/leadSource/leadSource.route.js";
import { LeadRoutes } from "../module/lead/lead.route.js";
import { MilestoneRoutes } from "../module/milestone/milestone.route.js";
import { OwnerWithdrawalRoutes } from "../module/ownerWithdrawal/ownerWithdrawal.route.js";
import {
    NotificationRoutes,
    PublicAgencyInviteRoutes,
    PlatformRoutes,
    PublicPlatformInviteRoutes,
} from "../module/platform/platform.route.js";
import { PaymentRoutes } from "../module/payment/payment.route.js";
import { ProjectRoutes } from "../module/project/project.route.js";
import { ProjectMemberRoutes } from "../module/projectMember/projectMember.route.js";
import { ReportRoutes } from "../module/report/report.route.js";
import { SettingsRoutes } from "../module/settings/settings.route.js";
import { TaskRoutes } from "../module/task/task.route.js";
import { TimeEntryRoutes } from "../module/timeEntry/timeEntry.route.js";
import { TeamPayoutRoutes } from "../module/teamPayout/teamPayout.route.js";
import { TransactionRoutes } from "../module/transaction/transaction.route.js";
import { UserRoutes } from "../module/user/user.route.js";
import { VaultRoutes } from "../module/vault/vault.route.js";

const router = Router();

router.use("/auth", AuthRoutes);
router.use("/dashboard", DashboardRoutes);
router.use("/users", UserRoutes);
router.use("/departments", DepartmentRoutes);
router.use("/team-invites", InviteRoutes);
// Public: whoever is opening the link has no account yet.
router.use("/join", PublicInviteRoutes);
router.use("/clients", ClientRoutes);
router.use("/client-links", ClientLinkRoutes);
router.use("/leads", LeadRoutes);
router.use("/lead-sources", LeadSourceRoutes);
router.use("/projects", ProjectRoutes);
router.use("/project-members", ProjectMemberRoutes);
router.use("/tasks", TaskRoutes);
router.use("/time-entries", TimeEntryRoutes);
router.use("/milestones", MilestoneRoutes);
router.use("/kpi-targets", KpiTargetRoutes);
router.use("/kpi", KpiRoutes);
router.use("/accounts", AccountRoutes);
router.use("/transactions", TransactionRoutes);
router.use("/invoices", InvoiceRoutes);
router.use("/payments", PaymentRoutes);
router.use("/exchanges", ExchangeRoutes);
router.use("/expense-categories", ExpenseCategoryRoutes);
router.use("/expenses", ExpenseRoutes);
router.use("/team-payouts", TeamPayoutRoutes);
router.use("/owner-withdrawals", OwnerWithdrawalRoutes);
router.use("/due-payments", DuePaymentRoutes);
router.use("/vault", VaultRoutes);
router.use("/reports", ReportRoutes);
router.use("/settings", SettingsRoutes);
router.use("/activity", ActivityRoutes);
router.use("/platform", PlatformRoutes);
router.use("/notifications", NotificationRoutes);
// Public: joining the platform team, before any account exists.
router.use("/platform-join", PublicPlatformInviteRoutes);
router.use("/agency-join", PublicAgencyInviteRoutes);

export const indexRoute = router;
