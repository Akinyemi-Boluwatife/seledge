import { ApiProperty } from '@nestjs/swagger';

export class AuthResponseDto {
  @ApiProperty({ description: 'JWT bearer token' })
  accessToken!: string;
}

export class RegisterResponseDto extends AuthResponseDto {
  @ApiProperty({ example: '019fedab-ef52-7308-9fea-253ba51377fa' })
  userId!: string;

  @ApiProperty({
    example: '1000000001',
    description: 'Auto-created NGN wallet',
  })
  accountNumber!: string;
}
