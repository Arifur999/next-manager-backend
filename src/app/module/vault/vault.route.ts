import { Router } from "express";
import { Role } from "../../../generated/prisma/enums.js";
import { checkAuth } from "../../middleware/checkAuth.js";
import { authRateLimit } from "../../middleware/rateLimit.js";
import { validateRequest } from "../../middleware/validateRequest.js";
import { VaultController } from "./vault.controller.js";
import { createCredentialZodSchema, updateCredentialZodSchema } from "./vault.validation.js";

const router = Router();

router.get("/", checkAuth(Role.admin, Role.sales, Role.project_manager), VaultController.getAllCredentials);

// Reveal is the only route that returns a real password, so it gets the tight
// rate limit as well as the role gate: someone walking the id space one request
// at a time is the realistic way this gets abused from inside.
router.get("/:id/reveal", checkAuth(Role.admin, Role.sales, Role.project_manager), authRateLimit, VaultController.revealCredential);

// Who looked at what is an admin question, not something every colleague
// needs - and it names colleagues.
router.get("/:id/access-log", checkAuth(Role.admin), VaultController.getAccessLog);

router.post("/", checkAuth(Role.admin, Role.sales, Role.project_manager), validateRequest(createCredentialZodSchema), VaultController.createCredential);
router.patch("/:id", checkAuth(Role.admin, Role.sales, Role.project_manager), validateRequest(updateCredentialZodSchema), VaultController.updateCredential);
router.delete("/:id", checkAuth(Role.admin), VaultController.deleteCredential);

export const VaultRoutes = router;
