import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { CommentsService } from './comments.service';
import { CreateCommentDto } from './dto/create-comment.dto';
import { UpdateCommentDto } from './dto/update-comment.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';

@ApiTags('Comments')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller()
export class CommentsController {
  constructor(private readonly commentsService: CommentsService) {}

  @Post('tasks/:taskId/comments')
  @ApiOperation({ summary: 'Add a comment to a task (Admin or assigned Employee)' })
  @ApiResponse({ status: 201, description: 'Comment created' })
  @ApiResponse({ status: 403, description: 'Forbidden if not admin or assigned' })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('taskId') taskId: string,
    @Body() dto: CreateCommentDto,
  ) {
    return this.commentsService.create(
      user.organizationId,
      taskId,
      user.id,
      user.role,
      user.name,
      dto,
    );
  }

  @Get('tasks/:taskId/comments')
  @ApiOperation({ summary: 'List all comments on a task' })
  @ApiResponse({ status: 200, description: 'List of comments' })
  async findByTaskId(
    @CurrentUser() user: AuthenticatedUser,
    @Param('taskId') taskId: string,
  ) {
    return this.commentsService.findByTaskId(
      user.organizationId,
      taskId,
      user.id,
      user.role,
    );
  }

  @Patch('comments/:id')
  @ApiOperation({ summary: 'Update a comment (Author or Admin only)' })
  @ApiResponse({ status: 200, description: 'Comment updated' })
  @ApiResponse({ status: 403, description: 'Cannot edit other users comments' })
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateCommentDto,
  ) {
    return this.commentsService.update(
      user.organizationId,
      id,
      user.id,
      user.role,
      dto,
    );
  }

  @Delete('comments/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a comment (Author or Admin only)' })
  @ApiResponse({ status: 200, description: 'Comment deleted' })
  async delete(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.commentsService.delete(
      user.organizationId,
      id,
      user.id,
      user.role,
    );
  }
}
