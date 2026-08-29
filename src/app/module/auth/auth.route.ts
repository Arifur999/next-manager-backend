import { Router } from "express";
import { checkAuth } from "../../middleware/checkAuth.js";
import { authRateLimit } from "../../middleware/rateLimit.js";
import { validateRequest } from "../../middleware/validateRequest.js";
import { AuthController } from "./auth.controller.js";
import {
    changePasswordZodSchema,
    forgotPasswordZodSchema,
    loginZodSchema,
    registerZodSchema,
    resetPasswordZodSchema,
    updateMeZodSchema,
} from "./auth.validation.js";

const router = Router();

router.post("/register", authRateLimit, validateRequest(registerZodSchema), AuthController.register);
router.post("/login", authRateLimit, validateRequest(loginZodSchema), AuthController.login);
router.post("/refresh-token", AuthController.refreshToken);
router.post("/logout", AuthController.logout);
router.get("/me", checkAuth(), AuthController.getMe);
// Behind authRateLimit like sign-in, and for the same reason: repeated
// attempts are the whole attack. An unthrottled forgot-password form is a way
// to mail-bomb somebody, and an unthrottled reset endpoint is somewhere to
// guess tokens.
router.post(
    "/forgot-password",
    authRateLimit,
    validateRequest(forgotPasswordZodSchema),
    AuthController.forgotPassword
);
router.post(
    "/reset-password",
    authRateLimit,
    validateRequest(resetPasswordZodSchema),
    AuthController.resetPassword
);

// Editing your own record. Not PATCH /users/:id - that one is admin-only and
// can move a role, which is exactly what this must never be able to do.
router.patch("/me", checkAuth(), validateRequest(updateMeZodSchema), AuthController.updateMe);

router.post("/change-password", checkAuth(), validateRequest(changePasswordZodSchema), AuthController.changePassword);

export const AuthRoutes = router;
