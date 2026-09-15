import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsOptional, IsString, IsUrl } from 'class-validator';
import { AttachmentPurpose } from '@prisma/client';

export class AttachLinkDto {
  @ApiProperty({
    example: 'https://www.figma.com/file/xyz123/Project-Brief',
    description: 'External link URL (e.g. Figma, GitHub PR, Google Docs, Loom)',
  })
  @IsUrl({}, { message: 'Must be a valid web URL starting with http:// or https://' })
  @IsNotEmpty()
  url: string;

  @ApiProperty({
    example: 'Final UI Mockups & Component Specs',
    description: 'Title or descriptive label for the link',
  })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({
    enum: AttachmentPurpose,
    default: AttachmentPurpose.OUTPUT,
    description: 'Attachment purpose: REFERENCE (admin spec), OUTPUT (work deliverable), or FOR_APPROVAL (requires sign-off)',
  })
  @IsEnum(AttachmentPurpose)
  @IsOptional()
  purpose?: AttachmentPurpose;
}
