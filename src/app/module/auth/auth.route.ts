import { Router } from "express";
import { checkAuth } from "../../middleware/checkAuth.js";
import { authRateLimit } from "../../middleware/rateLimit.js";
import { validateRequest } from "../../middleware/validateRequest.js";
import { AuthController } from "./auth.controller.js";
import { changePasswordZodSchema, loginZodSchema, registerZodSchema } from "./auth.validation.js";

const router = Router();

router.post("/register", authRateLimit, validateRequest(registerZodSchema), AuthController.register);
router.post("/login", authRateLimit, validateRequest(loginZodSchema), AuthController.login);
router.post("/refresh-token", AuthController.refreshToken);
router.post("/logout", AuthController.logout);
router.get("/me", checkAuth(), AuthController.getMe);
router.post("/change-password", checkAuth(), validateRequest(changePasswordZodSchema), AuthController.changePassword);

export const AuthRoutes = router;
