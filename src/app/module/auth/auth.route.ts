import { Router } from "express";
import { checkAuth } from "../../middleware/checkAuth.js";
import { authRateLimit } from "../../middleware/rateLimit.js";
import { validateRequest } from "../../middleware/validateRequest.js";
import { AuthController } from "./auth.controller.js";
import { changePasswordZodSchema, loginZodSchema, registerZodSchema, updateMeZodSchema } from "./auth.validation.js";

const router = Router();

router.post("/register", authRateLimit, validateRequest(registerZodSchema), AuthController.register);
router.post("/login", authRateLimit, validateRequest(loginZodSchema), AuthController.login);
router.post("/refresh-token", AuthController.refreshToken);
router.post("/logout", AuthController.logout);
router.get("/me", checkAuth(), AuthController.getMe);
// Editing your own record. Not PATCH /users/:id - that one is admin-only and
// can move a role, which is exactly what this must never be able to do.
router.patch("/me", checkAuth(), validateRequest(updateMeZodSchema), AuthController.updateMe);

router.post("/change-password", checkAuth(), validateRequest(changePasswordZodSchema), AuthController.changePassword);

export const AuthRoutes = router;
