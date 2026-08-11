import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsString } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'ada@example.com' })
  @IsEmail()
  @Transform(({ value }) => String(value).trim().toLowerCase())
  email!: string;

  @ApiProperty({ example: 'correct-horse-battery' })
  @IsString()
  password!: string;
}
