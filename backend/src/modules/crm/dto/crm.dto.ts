import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEmail,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { CrmActivityType, DealStatus, LeadSource, LeadStatus } from '@prisma/client';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class CreateContactDto {
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(120) name: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) phone?: string;
  @ApiPropertyOptional() @IsOptional() @IsEmail() @MaxLength(254) email?: string;
  @ApiPropertyOptional({ enum: LeadSource }) @IsOptional() @IsEnum(LeadSource) source?: LeadSource;
  @ApiPropertyOptional() @IsOptional() @IsUUID() accountId?: string;
  @ApiPropertyOptional({ description: 'Admin only; employees always own leads they create' })
  @IsOptional() @IsUUID() ownerId?: string;
  @ApiPropertyOptional({ description: 'Creates the first follow-up so the lead has a next action' })
  @IsOptional() @IsDateString() followUpAt?: string;
}

export class UpdateContactDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(2) @MaxLength(120) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) phone?: string;
  @ApiPropertyOptional() @IsOptional() @IsEmail() @MaxLength(254) email?: string;
  @ApiPropertyOptional({ enum: LeadStatus }) @IsOptional() @IsEnum(LeadStatus) leadStatus?: LeadStatus;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) lostReason?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() accountId?: string;
  @ApiPropertyOptional({ description: 'Admin only' }) @IsOptional() @IsUUID() ownerId?: string;
}

export class ContactFilterDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: LeadStatus }) @IsOptional() @IsEnum(LeadStatus) leadStatus?: LeadStatus;
  @ApiPropertyOptional() @IsOptional() @IsUUID() ownerId?: string;
}

export class CreateAccountDto {
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(160) name: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(15) gstin?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) industry?: string;
}

export class CreateStageDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(60) name: string;
  @ApiProperty() @Type(() => Number) @IsInt() @Min(0) position: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100) probability?: number;
}

export class CreateDealDto {
  @ApiProperty() @IsUUID() contactId: string;
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(160) title: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @Min(0) value?: number;
  @ApiPropertyOptional({ description: 'Defaults to the first stage' }) @IsOptional() @IsUUID() stageId?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() expectedCloseDate?: string;
  @ApiPropertyOptional({ description: 'Admin only' }) @IsOptional() @IsUUID() ownerId?: string;
}

export class UpdateDealDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(2) @MaxLength(160) title?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @Min(0) value?: number;
  @ApiPropertyOptional() @IsOptional() @IsUUID() stageId?: string;
  @ApiPropertyOptional({ enum: DealStatus }) @IsOptional() @IsEnum(DealStatus) status?: DealStatus;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) lostReason?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() expectedCloseDate?: string;
}

export class DealFilterDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: DealStatus }) @IsOptional() @IsEnum(DealStatus) status?: DealStatus;
  @ApiPropertyOptional() @IsOptional() @IsUUID() stageId?: string;
}

const LOGGABLE = Object.values(CrmActivityType).filter((t) => t !== CrmActivityType.SYSTEM);

export class LogActivityDto {
  @ApiProperty() @IsUUID() contactId: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() dealId?: string;
  @ApiProperty({ enum: LOGGABLE }) @IsIn(LOGGABLE) type: CrmActivityType;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(200) subject: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(5000) notes?: string;
  @ApiPropertyOptional({ description: 'Call disposition / meeting result' })
  @IsOptional() @IsString() @MaxLength(200) outcome?: string;
  @ApiPropertyOptional({ description: 'Set to schedule it (pending follow-up); omit to log it as done now' })
  @IsOptional() @IsDateString() dueAt?: string;
}

export class CompleteActivityDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) outcome?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(5000) notes?: string;
  @ApiPropertyOptional({ description: 'Schedules the next follow-up in the same step' })
  @IsOptional() @IsDateString() nextFollowUpAt?: string;
}
