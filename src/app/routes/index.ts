import { Router } from "express";
import { AuthRoutes } from "../module/auth/auth.route.js";
import { UserRoutes } from "../module/user/user.route.js";

const router = Router();

router.use("/auth", AuthRoutes);
router.use("/users", UserRoutes);

export const indexRoute = router;
