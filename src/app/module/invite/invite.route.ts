import { Router } from "express";
import { Role } from "../../../generated/prisma/enums.js";
import { checkAuth } from "../../middleware/checkAuth.js";
import { inviteTokenRateLimit } from "../../middleware/rateLimit.js";
import { validateRequest } from "../../middleware/validateRequest.js";
import { InviteController } from "./invite.controller.js";
import { acceptInviteZodSchema, createInviteZodSchema, rejectMemberZodSchema } from "./invite.validation.js";
import { tokenParams, idParams } from "../../shared/requestSchemas.js";

const router = Router();

// ---------------------------------------------------------------------------
// Public. Signed out by definition - the person has no account yet.
// ---------------------------------------------------------------------------
//
// Both are behind the strict invite-token rate limit rather than the general one: an
// unthrottled token lookup is somewhere to guess tokens, and the response
// tells you whether one was right.
router.get("/:token", inviteTokenRateLimit, validateRequest({ params: tokenParams }), InviteController.getInviteByToken);
router.post(
    "/:token/accept",
    inviteTokenRateLimit,
    validateRequest({ params: tokenParams, body: acceptInviteZodSchema }),
    InviteController.acceptInvite
);

export const PublicInviteRoutes = router;

// ---------------------------------------------------------------------------
// Admin. Sending, listing, revoking, and deciding who gets in.
// ---------------------------------------------------------------------------
const adminRouter = Router();

adminRouter.get("/", checkAuth(Role.admin), InviteController.getInvites);
adminRouter.post(
    "/",
    checkAuth(Role.admin),
    validateRequest(createInviteZodSchema),
    InviteController.createInvite
);
adminRouter.delete("/:id", checkAuth(Role.admin), validateRequest({ params: idParams }), InviteController.revokeInvite);

// Approval is the moment somebody actually gets access, and the moment a seat
// is charged. Admin only - a project manager who could admit people could
// grow the team past what the company agreed to pay for.
adminRouter.post("/members/:id/approve", checkAuth(Role.admin), validateRequest({ params: idParams }), InviteController.approveMember);
adminRouter.post(
    "/members/:id/reject",
    checkAuth(Role.admin),
    validateRequest({ params: idParams, body: rejectMemberZodSchema }),
    InviteController.rejectMember
);

export const InviteRoutes = adminRouter;
