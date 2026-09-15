import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString, Matches, MinLength } from 'class-validator';

export class RegisterDto {
  @ApiProperty({ example: 'Acme Corporation', description: 'Organization name' })
  @IsString()
  @MinLength(2)
  organizationName: string;

  @ApiProperty({ example: 'acme', description: 'Unique organization slug' })
  @IsString()
  @Matches(/^[a-z0-9-]+$/, { message: 'Slug must contain only lowercase alphanumeric characters and hyphens' })
  organizationSlug: string;

  @ApiProperty({ example: 'Alice Smith', description: 'Admin full name' })
  @IsString()
  @MinLength(2)
  adminName: string;

  @ApiProperty({ example: 'admin@acme.com', description: 'Admin email' })
  @IsEmail()
  adminEmail: string;

  @ApiProperty({ example: 'Password123!', description: 'Admin password', minLength: 8 })
  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  password: string;
}
