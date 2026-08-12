import { plainToInstance } from 'class-transformer';
import {
  IsInt,
  IsString,
  IsUrl,
  Max,
  Min,
  MinLength,
  validateSync,
} from 'class-validator';

class EnvironmentVariables {
  @IsUrl({
    protocols: ['postgresql', 'postgres'],
    require_protocol: true,
    require_tld: false,
  })
  DATABASE_URL!: string;

  @IsInt()
  @Min(1)
  @Max(65535)
  PORT!: number;

  @IsString()
  NODE_ENV!: string;

  @IsString()
  @MinLength(32)
  JWT_SECRET!: string;

  @IsInt()
  @Min(60)
  JWT_EXPIRES_IN_SECONDS!: number;

  @IsString()
  @MinLength(32)
  WEBHOOK_SECRET!: string;
}

export function validateEnv(config: Record<string, unknown>) {
  const validated = plainToInstance(
    EnvironmentVariables,
    {
      NODE_ENV: 'development',
      PORT: 3000,
      JWT_EXPIRES_IN_SECONDS: 900,
      ...config,
    },
    { enableImplicitConversion: true },
  );

  const errors = validateSync(validated, { skipMissingProperties: false });
  if (errors.length > 0) {
    const details = errors
      .map((e) => `${e.property}: ${Object.values(e.constraints ?? {}).join(', ')}`)
      .join('\n  ');
    throw new Error(`Invalid environment configuration:\n  ${details}`);
  }

  return validated;
}
