import { Router } from "express";
import { checkAuth } from "../../middleware/checkAuth.js";
import { requireCompany } from "../../middleware/requireCompany.js";
import { validateRequest } from "../../middleware/validateRequest.js";
import { ChatController } from "./chat.controller.js";
import {
    addMembersZodSchema,
    createConversationZodSchema,
    sendMessageZodSchema,
} from "./chat.validation.js";

const router = Router();

// Everybody in a company, with no role gate at all - and that is deliberate.
//
// Who may read a conversation is not a question about job titles: it is
// answered by whether there is a ConversationMember row, checked in the service
// on every single call. A role list here would be a second, weaker answer to
// the same question, and the two would eventually disagree.
const member = [checkAuth(), requireCompany] as const;

// The badge in the navbar. Declared before /:id so the literal path is not
// swallowed by the parameter route.
router.get("/unread", ...member, ChatController.getUnreadTotal);

router.get("/", ...member, ChatController.getConversations);
router.post(
    "/",
    ...member,
    validateRequest(createConversationZodSchema),
    ChatController.createConversation
);

router.get("/:id/messages", ...member, ChatController.getMessages);
// Persisted here and broadcast afterwards, never socket-only: a dropped
// connection must not lose a message.
router.post(
    "/:id/messages",
    ...member,
    validateRequest(sendMessageZodSchema),
    ChatController.sendMessage
);

router.post("/:id/read", ...member, ChatController.markRead);
router.post(
    "/:id/members",
    ...member,
    validateRequest(addMembersZodSchema),
    ChatController.addMembers
);
router.post("/:id/leave", ...member, ChatController.leave);
router.post("/:id/archive", ...member, ChatController.setArchived);

export const ChatRoutes = router;
