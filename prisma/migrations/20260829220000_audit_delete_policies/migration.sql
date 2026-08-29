-- Two delete policies that destroyed the wrong things.
--
-- Neither had fired yet: the app soft-deletes people and never hard-deletes
-- them, so both were waiting for the first cleanup script, GDPR erasure or
-- direct database edit. Found by comparing the two audit logs against each
-- other and noticing they disagreed.

-- 1. The vault access log - who revealed which client password - was CASCADE
--    on its user, while the general activity log was SET NULL. So deleting a
--    person erased the record of every credential they had opened: reveal a
--    client's passwords, have the account removed, and the evidence goes with
--    it. It is the more sensitive of the two logs and it was the one that did
--    not survive. Now both agree, and the entry outlives the person.
ALTER TABLE "credential_access_logs" DROP CONSTRAINT "credential_access_logs_user_id_fkey";
ALTER TABLE "credential_access_logs" ALTER COLUMN "user_id" DROP NOT NULL;
ALTER TABLE "credential_access_logs" ADD CONSTRAINT "credential_access_logs_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 2. Time entries were CASCADE on their user, so hard-deleting somebody
--    destroyed every hour they had ever logged - and those hours are the
--    denominator of utilization, the numerator of realization, and the basis
--    of every project cost figure. A finished quarter's numbers would have
--    changed silently, months later, because somebody tidied up a leaver.
--
--    RESTRICT rather than SET NULL: hours with nobody attached break
--    per-person utilization just as badly, and refusing the delete is the
--    honest answer. It matches how payments already refuse to let their client
--    be erased.
ALTER TABLE "time_entries" DROP CONSTRAINT "time_entries_user_id_fkey";
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
