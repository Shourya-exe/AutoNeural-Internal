import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'info@autoneural.in', description: 'User account email' })
  @IsEmail({}, { message: 'Please enter a valid email address' })
  @MaxLength(254)
  email: string;

  @ApiProperty({ example: 'Password123!', description: 'User account password' })
  @IsString()
  @IsNotEmpty({ message: 'Password is required' })
  password: string;
}
