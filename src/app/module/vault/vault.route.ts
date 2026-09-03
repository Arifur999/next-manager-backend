import { Router } from "express";
import { Role } from "../../../generated/prisma/enums.js";
import { checkAuth } from "../../middleware/checkAuth.js";
import { requirePermission } from "../../middleware/requirePermission.js";
import { authRateLimit } from "../../middleware/rateLimit.js";
import { validateRequest } from "../../middleware/validateRequest.js";
import { VaultController } from "./vault.controller.js";
import { createCredentialZodSchema, updateCredentialZodSchema } from "./vault.validation.js";

const router = Router();

// Operations reads this through the project detail page, never the standalone
// vault screen - the route rule keeps that page shut. WHICH credentials they
// get is decided in the service: only those on a project they are a member of.
router.get("/", checkAuth(Role.admin, Role.sales, Role.project_manager, Role.operations), VaultController.getAllCredentials);

// Reveal is the only route that returns a real password, so it gets the tight
// rate limit as well as the role gate: someone walking the id space one request
// at a time is the realistic way this gets abused from inside.
router.get("/:id/reveal", checkAuth(Role.admin, Role.sales, Role.project_manager, Role.operations), requirePermission("vault.reveal"), authRateLimit, VaultController.revealCredential);

// Who looked at what is an admin question, not something every colleague
// needs - and it names colleagues.
router.get("/:id/access-log", checkAuth(Role.admin), VaultController.getAccessLog);

router.post("/", checkAuth(Role.admin, Role.sales, Role.project_manager), validateRequest(createCredentialZodSchema), VaultController.createCredential);
router.patch("/:id", checkAuth(Role.admin, Role.sales, Role.project_manager), validateRequest(updateCredentialZodSchema), VaultController.updateCredential);
router.delete("/:id", checkAuth(Role.admin), VaultController.deleteCredential);

export const VaultRoutes = router;
