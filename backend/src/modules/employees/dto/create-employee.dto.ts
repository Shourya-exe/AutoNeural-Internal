import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import { Role } from '@prisma/client';

export class CreateEmployeeDto {
  @ApiProperty({ example: 'John Doe', description: 'Employee full name' })
  @IsString()
  @IsNotEmpty({ message: 'Full name is required' })
  name: string;

  @ApiProperty({ example: 'john@autoneural.in', description: 'Employee work email' })
  @IsEmail({}, { message: 'Valid email address is required' })
  email: string;

  @ApiPropertyOptional({
    example: 'Password123!',
    description: 'Initial password (auto-generated if omitted)',
  })
  @IsOptional()
  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  password?: string;

  @ApiPropertyOptional({ enum: Role, default: Role.EMPLOYEE })
  @IsOptional()
  @IsEnum(Role)
  role?: Role = Role.EMPLOYEE;

  @ApiPropertyOptional({ example: 'Engineering' })
  @IsOptional()
  @IsString()
  department?: string;

  @ApiPropertyOptional({ example: 'Software Engineer' })
  @IsOptional()
  @IsString()
  jobTitle?: string;

  @ApiPropertyOptional({ example: 'https://images.example.com/avatars/john.png' })
  @IsOptional()
  @IsString()
  avatarUrl?: string;
}
