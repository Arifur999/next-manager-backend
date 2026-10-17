import status from "http-status";
import { UserStatus } from "../../../generated/prisma/enums.js";
import { StatusCategory } from "../../../generated/prisma/enums.js";
import AppError from "../../errorHelpers/AppError.js";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import { prisma } from "../../lib/prisma.js";
import { IAssignMemberPayload } from "./projectMember.validation.js";

/** Who is on which project: read per project by the project screen and per person by the team screen. */

const MEMBER_SELECT = {
    id: true,
    role_on_project: true,
    created_at: true,
    user: { select: { id: true, full_name: true, email: true, avatar_url: true, role: true } },
} as const;

const getProjectMembers = async (projectId: string, user: IRequestUser) => {
    const project = await prisma.project.findFirst({
        where: { id: projectId, organization_id: user.organizationId, deleted_at: null },
        select: { id: true },
    });

    if (!project) {
        throw new AppError(status.NOT_FOUND, "Project not found");
    }

    return prisma.projectMember.findMany({
        where: { project_id: projectId, organization_id: user.organizationId },
        select: MEMBER_SELECT,
        orderBy: { created_at: "asc" },
    });
};

/**
 * The whole agency's assignments by person, in two queries, listing everyone -
 * the people on nothing are usually what the screen is opened to find.
 */
const getAssignmentOverview = async (user: IRequestUser) => {
    const [members, assignments] = await Promise.all([
        prisma.user.findMany({
            where: { organization_id: user.organizationId, deleted_at: null, status: UserStatus.active },
            select: { id: true, full_name: true, email: true, avatar_url: true, role: true },
            orderBy: { full_name: "asc" },
        }),
        prisma.projectMember.findMany({
            where: { organization_id: user.organizationId },
            select: {
                id: true,
                user_id: true,
                role_on_project: true,
                project: { select: { id: true, name: true, code: true, status: true } },
            },
        }),
    ]);

    const byUser = new Map<string, typeof assignments>();
    for (const assignment of assignments) {
        const list = byUser.get(assignment.user_id) ?? [];
        list.push(assignment);
        byUser.set(assignment.user_id, list);
    }

    return members.map((member) => {
        const own = byUser.get(member.id) ?? [];
        return {
            user: member,
            assignments: own.map((entry) => ({
                id: entry.id,
                role_on_project: entry.role_on_project,
                project: entry.project,
            })),
            // Only live work counts towards load, judged by status category
            // rather than name, so renamed or added statuses still count.
            active_count: own.filter(
                (entry) => entry.project.status.category === StatusCategory.active
            ).length,
        };
    });
};

const assignMember = async (payload: IAssignMemberPayload, user: IRequestUser) => {
    return prisma.$transaction(async (tx) => {
        const [project, member] = await Promise.all([
            tx.project.findFirst({
                where: { id: payload.project_id, organization_id: user.organizationId, deleted_at: null },
                select: { id: true },
            }),
            tx.user.findFirst({
                where: { id: payload.user_id, organization_id: user.organizationId, deleted_at: null },
                select: { id: true },
            }),
        ]);

        if (!project) throw new AppError(status.NOT_FOUND, "Project not found");
        if (!member) throw new AppError(status.NOT_FOUND, "Team member not found");

        const existing = await tx.projectMember.findFirst({
            where: { project_id: payload.project_id, user_id: payload.user_id },
            select: { id: true },
        });

        if (existing) {
            // Re-assigning is how the role on a project gets changed, so this
            // updates rather than refusing - the unique index would reject a
            // second row anyway, and a 409 here would be a worse answer than
            // just doing what was asked.
            return tx.projectMember.update({
                where: { id: existing.id },
                data: { role_on_project: payload.role_on_project ?? "" },
                select: MEMBER_SELECT,
            });
        }

        return tx.projectMember.create({
            data: {
                organization_id: user.organizationId,
                project_id: payload.project_id,
                user_id: payload.user_id,
                role_on_project: payload.role_on_project ?? "",
            },
            select: MEMBER_SELECT,
        });
    });
};

const removeMember = async (id: string, user: IRequestUser) => {
    const existing = await prisma.projectMember.findFirst({
        where: { id, organization_id: user.organizationId },
        select: { id: true },
    });

    if (!existing) {
        throw new AppError(status.NOT_FOUND, "Assignment not found");
    }

    // A hard delete is right here: an assignment carries no money and no
    // history worth keeping, unlike every other delete in this app.
    await prisma.projectMember.delete({ where: { id } });

    return { message: "Removed from the project" };
};

export const ProjectMemberService = {
    getProjectMembers,
    getAssignmentOverview,
    assignMember,
    removeMember,
};
