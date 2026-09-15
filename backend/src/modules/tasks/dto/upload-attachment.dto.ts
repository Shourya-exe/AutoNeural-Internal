import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { AttachmentPurpose } from '@prisma/client';

export class UploadAttachmentDto {
  @ApiPropertyOptional({
    enum: AttachmentPurpose,
    default: AttachmentPurpose.OUTPUT,
    description: 'Purpose: REFERENCE (admin briefing/doc), OUTPUT (work deliverable), or FOR_APPROVAL (requires sign-off)',
  })
  @IsEnum(AttachmentPurpose)
  @IsOptional()
  purpose?: AttachmentPurpose;

  @ApiPropertyOptional({
    example: 'Client Proposal v2.pdf',
    description: 'Custom display name for the uploaded document/file (defaults to original filename)',
  })
  @IsString()
  @IsOptional()
  name?: string;
}
