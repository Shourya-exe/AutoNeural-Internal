import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  UseInterceptors,
  UploadedFile,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiConsumes } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import * as fs from 'fs';
import { TasksService } from './tasks.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { AssignTaskDto } from './dto/assign-task.dto';
import { UpdateStatusDto } from './dto/update-status.dto';
import { UpdateProgressDto } from './dto/update-progress.dto';
import { TaskFilterDto } from './dto/task-filter.dto';
import { AttachLinkDto } from './dto/attach-link.dto';
import { UploadAttachmentDto } from './dto/upload-attachment.dto';
import { ReviewSubmissionDto } from './dto/review-submission.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { Role } from '@prisma/client';

@ApiTags('Tasks')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('tasks')
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  @Post()
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Create a new task and optionally assign employees (Admin only)' })
  @ApiResponse({ status: 201, description: 'Task created successfully' })
  @ApiResponse({ status: 403, description: 'Admin role required' })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateTaskDto,
  ) {
    return this.tasksService.create(
      user.organizationId,
      user.id,
      user.name,
      dto,
    );
  }

  @Get()
  @ApiOperation({ summary: 'List tasks (Admins see all org tasks, Employees see assigned tasks)' })
  @ApiResponse({ status: 200, description: 'Paginated list of tasks' })
  async findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: TaskFilterDto,
  ) {
    return this.tasksService.findAll(
      user.organizationId,
      user.id,
      user.role,
      query,
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get task details, assignees, and statistics by ID' })
  @ApiResponse({ status: 200, description: 'Task details' })
  @ApiResponse({ status: 403, description: 'Employees can only view assigned tasks' })
  @ApiResponse({ status: 404, description: 'Task not found' })
  async findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.tasksService.findOne(
      user.organizationId,
      id,
      user.id,
      user.role,
    );
  }

  @Patch(':id')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Update task details (Admin only)' })
  @ApiResponse({ status: 200, description: 'Task updated successfully' })
  @ApiResponse({ status: 403, description: 'Admin role required' })
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateTaskDto,
  ) {
    return this.tasksService.update(
      user.organizationId,
      id,
      user.id,
      user.name,
      dto,
    );
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a task (Admin only)' })
  @ApiResponse({ status: 200, description: 'Task deleted successfully' })
  async delete(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.tasksService.delete(user.organizationId, id);
  }

  @Post(':id/assign')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Assign or reassign employees to a task (Admin only)' })
  @ApiResponse({ status: 200, description: 'Task reassignments saved' })
  async assign(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: AssignTaskDto,
  ) {
    return this.tasksService.assign(
      user.organizationId,
      id,
      user.id,
      user.name,
      dto,
    );
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Update task status (Admin or assigned Employee)' })
  @ApiResponse({ status: 200, description: 'Status updated successfully' })
  @ApiResponse({ status: 403, description: 'Cannot update status on unassigned task' })
  async updateStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateStatusDto,
  ) {
    return this.tasksService.updateStatus(
      user.organizationId,
      id,
      user.id,
      user.role,
      user.name,
      dto,
    );
  }

  @Patch(':id/progress')
  @ApiOperation({ summary: 'Update task progress percentage 0-100 (Admin or assigned Employee)' })
  @ApiResponse({ status: 200, description: 'Progress updated successfully' })
  @ApiResponse({ status: 403, description: 'Cannot update progress on unassigned task' })
  async updateProgress(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateProgressDto,
  ) {
    return this.tasksService.updateProgress(
      user.organizationId,
      id,
      user.id,
      user.role,
      user.name,
      dto,
    );
  }

  @Post(':id/attachments/link')
  @ApiOperation({ summary: 'Attach a link to a task (Admin reference or Employee deliverable/approval)' })
  @ApiResponse({ status: 201, description: 'Link attached successfully' })
  async attachLink(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: AttachLinkDto,
  ) {
    return this.tasksService.attachLink(user.organizationId, id, user, dto);
  }

  @Post(':id/attachments/upload')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload a document or file to a task (Admin reference or Employee deliverable/approval)' })
  @ApiResponse({ status: 201, description: 'File uploaded and attached successfully' })
  async uploadAttachment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadAttachmentDto,
  ) {
    return this.tasksService.uploadAttachment(user.organizationId, id, user, file, dto);
  }

  @Get(':id/attachments')
  @ApiOperation({ summary: 'List all attachments, documents, and links for a task' })
  @ApiResponse({ status: 200, description: 'List of task attachments' })
  async findAllAttachments(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.tasksService.findAllAttachments(
      user.organizationId,
      id,
      user.id,
      user.role,
    );
  }

  @Get(':id/attachments/:attachmentId/download')
  @ApiOperation({ summary: 'Download or stream an uploaded task file/document' })
  async downloadAttachment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('attachmentId') attachmentId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const fileInfo = await this.tasksService.getAttachmentFile(
      user.organizationId,
      id,
      attachmentId,
      user.id,
      user.role,
    );

    res.set({
      'Content-Type': fileInfo.mimeType,
      'Content-Disposition': `attachment; filename="${encodeURIComponent(fileInfo.fileName)}"`,
    });

    const fileStream = fs.createReadStream(fileInfo.storagePath);
    return new StreamableFile(fileStream);
  }

  @Post(':id/attachments/:attachmentId/approve')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Approve an employee submission/deliverable (Admin only)' })
  @ApiResponse({ status: 200, description: 'Submission approved successfully' })
  async approveSubmission(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('attachmentId') attachmentId: string,
    @Body() dto: ReviewSubmissionDto,
  ) {
    return this.tasksService.approveSubmission(
      user.organizationId,
      id,
      attachmentId,
      user,
      dto,
    );
  }

  @Post(':id/attachments/:attachmentId/reject')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Reject or request changes on an employee submission (Admin only)' })
  @ApiResponse({ status: 200, description: 'Submission rejected / changes requested' })
  async rejectSubmission(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('attachmentId') attachmentId: string,
    @Body() dto: ReviewSubmissionDto,
  ) {
    return this.tasksService.rejectSubmission(
      user.organizationId,
      id,
      attachmentId,
      user,
      dto,
    );
  }

  @Delete(':id/attachments/:attachmentId')
  @ApiOperation({ summary: 'Delete a task attachment (Admin or original uploader)' })
  @ApiResponse({ status: 200, description: 'Attachment deleted successfully' })
  async deleteAttachment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('attachmentId') attachmentId: string,
  ) {
    return this.tasksService.deleteAttachment(
      user.organizationId,
      id,
      attachmentId,
      user,
    );
  }
}
