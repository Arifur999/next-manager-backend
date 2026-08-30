-- Two notification events for leave.
--
-- Added to the enum rather than cast at the call site: an event nothing can
-- name is one the settings screen cannot switch off, and a string cast would
-- have hidden that from the compiler.

ALTER TYPE "NotificationEvent" ADD VALUE 'leave_requested';
ALTER TYPE "NotificationEvent" ADD VALUE 'leave_decided';
