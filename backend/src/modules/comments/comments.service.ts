import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCommentDto } from './dto/create-comment.dto';
import { UpdateCommentDto } from './dto/update-comment.dto';
import { ActivitiesService } from '../activities/activities.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ActivityAction, NotificationType, Role } from '@prisma/client';

@Injectable()
export class CommentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activitiesService: ActivitiesService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async create(
    organizationId: string,
    taskId: string,
    authorId: string,
    authorRole: Role,
    authorName: string,
    dto: CreateCommentDto,
  ) {
    const task = await this.prisma.task.findFirst({
      where: { id: taskId, organizationId },
      include: { assignments: true },
    });

    if (!task) {
      throw new NotFoundException(`Task with ID ${taskId} not found`);
    }

    const isAssigned = task.assignments.some((a) => a.employeeId === authorId);
    if (authorRole !== Role.ADMIN && !isAssigned) {
      throw new ForbiddenException('You do not have permission to comment on this task');
    }

    const comment = await this.prisma.comment.create({
      data: {
        taskId,
        authorId,
        content: dto.content.trim(),
      },
      include: {
        author: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            avatarUrl: true,
          },
        },
      },
    });

    // Log Activity
    await this.activitiesService.log({
      taskId,
      userId: authorId,
      action: ActivityAction.COMMENT_ADDED,
      comment: dto.content.trim().slice(0, 100),
    });

    // Notify Counterparties
    if (authorRole === Role.EMPLOYEE) {
      // Notify creator/admin
      await this.notificationsService.create({
        userId: task.createdById,
        taskId,
        type: NotificationType.TASK_UPDATED,
        title: 'New Comment on Task',
        message: `${authorName} commented on task "${task.title}": "${dto.content.trim().slice(0, 60)}..."`,
      });
    } else {
      // Notify all assignees
      for (const assignment of task.assignments) {
        if (assignment.employeeId !== authorId) {
          await this.notificationsService.create({
            userId: assignment.employeeId,
            taskId,
            type: NotificationType.TASK_UPDATED,
            title: 'New Comment from Admin',
            message: `${authorName} commented on your task "${task.title}": "${dto.content.trim().slice(0, 60)}..."`,
          });
        }
      }
    }

    return comment;
  }

  async findByTaskId(
    organizationId: string,
    taskId: string,
    userId: string,
    role: Role,
  ) {
    const task = await this.prisma.task.findFirst({
      where: { id: taskId, organizationId },
      include: { assignments: true },
    });

    if (!task) {
      throw new NotFoundException(`Task with ID ${taskId} not found`);
    }

    const isAssigned = task.assignments.some((a) => a.employeeId === userId);
    if (role !== Role.ADMIN && !isAssigned) {
      throw new ForbiddenException('You do not have access to comments for this task');
    }

    return this.prisma.comment.findMany({
      where: { taskId },
      include: {
        author: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            avatarUrl: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async update(
    organizationId: string,
    commentId: string,
    userId: string,
    role: Role,
    dto: UpdateCommentDto,
  ) {
    const comment = await this.prisma.comment.findUnique({
      where: { id: commentId },
      include: { task: true },
    });

    if (!comment || comment.task.organizationId !== organizationId) {
      throw new NotFoundException(`Comment with ID ${commentId} not found`);
    }

    if (role !== Role.ADMIN && comment.authorId !== userId) {
      throw new ForbiddenException('You can only edit your own comments');
    }

    return this.prisma.comment.update({
      where: { id: commentId },
      data: { content: dto.content.trim() },
      include: {
        author: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            avatarUrl: true,
          },
        },
      },
    });
  }

  async delete(
    organizationId: string,
    commentId: string,
    userId: string,
    role: Role,
  ) {
    const comment = await this.prisma.comment.findUnique({
      where: { id: commentId },
      include: { task: true },
    });

    if (!comment || comment.task.organizationId !== organizationId) {
      throw new NotFoundException(`Comment with ID ${commentId} not found`);
    }

    if (role !== Role.ADMIN && comment.authorId !== userId) {
      throw new ForbiddenException('You can only delete your own comments');
    }

    await this.prisma.comment.delete({ where: { id: commentId } });
    return { success: true, message: 'Comment deleted successfully' };
  }
}
