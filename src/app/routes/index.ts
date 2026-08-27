import { Router } from "express";
import { AccountRoutes } from "../module/account/account.route.js";
import { AuthRoutes } from "../module/auth/auth.route.js";
import { ClientRoutes } from "../module/client/client.route.js";
import { PaymentRoutes } from "../module/payment/payment.route.js";
import { UserRoutes } from "../module/user/user.route.js";

const router = Router();

router.use("/auth", AuthRoutes);
router.use("/users", UserRoutes);
router.use("/clients", ClientRoutes);
router.use("/accounts", AccountRoutes);
router.use("/payments", PaymentRoutes);

export const indexRoute = router;
