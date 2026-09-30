import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuthenticatedUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { CrmService } from './crm.service';
import {
  CompleteActivityDto,
  ContactFilterDto,
  CreateAccountDto,
  CreateContactDto,
  CreateDealDto,
  CreateStageDto,
  DealFilterDto,
  LogActivityDto,
  UpdateContactDto,
  UpdateDealDto,
} from './dto/crm.dto';

@ApiTags('CRM')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('crm')
export class CrmController {
  constructor(private readonly crm: CrmService) {}

  @Get('attention')
  @ApiOperation({ summary: 'Open leads without a next action, and overdue follow-ups' })
  attention(@CurrentUser() u: AuthenticatedUser) {
    return this.crm.attention(u);
  }

  @Get('accounts')
  listAccounts(@CurrentUser() u: AuthenticatedUser, @Query('search') search?: string) {
    return this.crm.listAccounts(u, search);
  }

  @Post('accounts')
  createAccount(@CurrentUser() u: AuthenticatedUser, @Body() dto: CreateAccountDto) {
    return this.crm.createAccount(u, dto);
  }

  @Get('contacts')
  listContacts(@CurrentUser() u: AuthenticatedUser, @Query() q: ContactFilterDto) {
    return this.crm.listContacts(u, q);
  }

  @Post('contacts')
  @ApiOperation({ summary: 'Create a lead (409 with existingId if phone/email already exists)' })
  createContact(@CurrentUser() u: AuthenticatedUser, @Body() dto: CreateContactDto) {
    return this.crm.createContact(u, dto);
  }

  @Get('contacts/:id')
  getContact(@CurrentUser() u: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.crm.getContact(u, id);
  }

  @Patch('contacts/:id')
  updateContact(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateContactDto,
  ) {
    return this.crm.updateContact(u, id, dto);
  }

  @Get('contacts/:id/timeline')
  @ApiOperation({ summary: 'Customer 360 timeline with next action' })
  timeline(@CurrentUser() u: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.crm.timeline(u, id);
  }

  @Get('stages')
  listStages(@CurrentUser() u: AuthenticatedUser) {
    return this.crm.listStages(u);
  }

  @Post('stages')
  @Roles(Role.ADMIN)
  createStage(@CurrentUser() u: AuthenticatedUser, @Body() dto: CreateStageDto) {
    return this.crm.createStage(u, dto);
  }

  @Get('deals')
  listDeals(@CurrentUser() u: AuthenticatedUser, @Query() q: DealFilterDto) {
    return this.crm.listDeals(u, q);
  }

  @Post('deals')
  createDeal(@CurrentUser() u: AuthenticatedUser, @Body() dto: CreateDealDto) {
    return this.crm.createDeal(u, dto);
  }

  @Patch('deals/:id')
  updateDeal(@CurrentUser() u: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateDealDto) {
    return this.crm.updateDeal(u, id, dto);
  }

  @Post('activities')
  @ApiOperation({ summary: 'Log a call/message/meeting/note, or schedule a follow-up (dueAt)' })
  logActivity(@CurrentUser() u: AuthenticatedUser, @Body() dto: LogActivityDto) {
    return this.crm.logActivity(u, dto);
  }

  @Post('activities/:id/complete')
  completeActivity(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CompleteActivityDto,
  ) {
    return this.crm.completeActivity(u, id, dto);
  }
}
