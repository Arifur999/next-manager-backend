import { Router } from "express";
import { AccountRoutes } from "../module/account/account.route.js";
import { AuthRoutes } from "../module/auth/auth.route.js";
import { ClientRoutes } from "../module/client/client.route.js";
import { ExchangeRoutes } from "../module/exchange/exchange.route.js";
import { ExpenseRoutes } from "../module/expense/expense.route.js";
import { ExpenseCategoryRoutes } from "../module/expenseCategory/expenseCategory.route.js";
import { PaymentRoutes } from "../module/payment/payment.route.js";
import { TeamPayoutRoutes } from "../module/teamPayout/teamPayout.route.js";
import { UserRoutes } from "../module/user/user.route.js";

const router = Router();

router.use("/auth", AuthRoutes);
router.use("/users", UserRoutes);
router.use("/clients", ClientRoutes);
router.use("/accounts", AccountRoutes);
router.use("/payments", PaymentRoutes);
router.use("/exchanges", ExchangeRoutes);
router.use("/expense-categories", ExpenseCategoryRoutes);
router.use("/expenses", ExpenseRoutes);
router.use("/team-payouts", TeamPayoutRoutes);

export const indexRoute = router;
