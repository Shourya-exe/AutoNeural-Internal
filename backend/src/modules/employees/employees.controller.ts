import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
  HttpStatus,
  HttpCode,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { EmployeesService } from './employees.service';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { EmployeeFilterDto } from './dto/employee-filter.dto';
import { RequestRemovalDto } from './dto/request-removal.dto';
import { ReviewRemovalDto } from './dto/review-removal.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { RemovalRequestStatus, Role } from '@prisma/client';

@ApiTags('Employees')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('employees')
export class EmployeesController {
  constructor(private readonly employeesService: EmployeesService) {}

  @Post()
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Create a new employee account (Admin only)' })
  @ApiResponse({ status: 201, description: 'Employee account created' })
  @ApiResponse({ status: 403, description: 'Forbidden. Admin role required' })
  @ApiResponse({ status: 409, description: 'Email already exists' })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateEmployeeDto,
  ) {
    return this.employeesService.create(user.organizationId, dto);
  }

  @Get()
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'List all employees with pagination and filters (Admin only)' })
  @ApiResponse({ status: 200, description: 'Paginated list of employees' })
  async findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: EmployeeFilterDto,
  ) {
    return this.employeesService.findAll(user.organizationId, query);
  }

  @Get(':id')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Get employee details and statistics by ID (Admin only)' })
  @ApiResponse({ status: 200, description: 'Employee profile and assignment stats' })
  @ApiResponse({ status: 404, description: 'Employee not found' })
  async findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.employeesService.findOne(user.organizationId, id);
  }

  @Patch(':id')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Update employee information (Admin only)' })
  @ApiResponse({ status: 200, description: 'Employee updated successfully' })
  @ApiResponse({ status: 404, description: 'Employee not found' })
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateEmployeeDto,
  ) {
    return this.employeesService.update(user.organizationId, id, dto);
  }

  @Patch(':id/deactivate')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Deactivate an employee account (Admin only)' })
  @ApiResponse({ status: 200, description: 'Account deactivated' })
  @ApiResponse({ status: 400, description: 'Cannot deactivate own account' })
  async deactivate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.employeesService.deactivate(user.organizationId, id, user.id);
  }

  @Patch(':id/reactivate')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reactivate an inactive employee account (Admin only)' })
  @ApiResponse({ status: 200, description: 'Account reactivated' })
  async reactivate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.employeesService.reactivate(user.organizationId, id);
  }

  @Post(':id/removal-request')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Request removal/deactivation of an employee (Requires second admin approval)' })
  @ApiResponse({ status: 201, description: 'Removal request submitted for co-admin review' })
  @ApiResponse({ status: 400, description: 'Cannot request own removal' })
  @ApiResponse({ status: 409, description: 'Removal request already pending' })
  async requestRemoval(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: RequestRemovalDto,
  ) {
    return this.employeesService.requestRemoval(
      user.organizationId,
      id,
      user.id,
      user.name,
      dto.reason,
    );
  }

  @Get('removal-requests/list')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'List all pending and completed employee removal requests (Admin only)' })
  @ApiResponse({ status: 200, description: 'List of removal requests' })
  async listRemovalRequests(
    @CurrentUser() user: AuthenticatedUser,
    @Query('status') status?: RemovalRequestStatus,
  ) {
    return this.employeesService.findAllRemovalRequests(user.organizationId, status);
  }

  @Post('removal-requests/:requestId/approve')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Approve employee removal request (Must be approved by a different admin than the requester)' })
  @ApiResponse({ status: 200, description: 'Removal approved and employee deactivated' })
  @ApiResponse({ status: 403, description: 'Dual-authorization required: cannot approve own request' })
  async approveRemoval(
    @CurrentUser() user: AuthenticatedUser,
    @Param('requestId') requestId: string,
    @Body() dto: ReviewRemovalDto,
  ) {
    return this.employeesService.approveRemoval(
      user.organizationId,
      requestId,
      user.id,
      user.name,
      dto.note,
    );
  }

  @Post('removal-requests/:requestId/reject')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reject employee removal request (Admin only)' })
  @ApiResponse({ status: 200, description: 'Removal request rejected' })
  async rejectRemoval(
    @CurrentUser() user: AuthenticatedUser,
    @Param('requestId') requestId: string,
    @Body() dto: ReviewRemovalDto,
  ) {
    return this.employeesService.rejectRemoval(
      user.organizationId,
      requestId,
      user.id,
      user.name,
      dto.note,
    );
  }
}
