import {
  ConflictException,
  Injectable,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomBytes } from 'node:crypto';
import * as argon2 from 'argon2';
import { AccountsService } from '../accounts/accounts.service';
import { AccountResponseDto } from '../accounts/dto/account-response.dto';
import { PrismaService } from '../prisma/prisma.service';
import { Role } from '../generated/prisma/enums';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { AuthResponseDto, RegisterResponseDto } from './dto/auth-response.dto';

export interface JwtPayload {
  sub: string;
  role: Role;
}

const DEFAULT_CURRENCY = 'NGN';

@Injectable()
export class AuthService implements OnModuleInit {
  private dummyHash!: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: AccountsService,
    private readonly jwt: JwtService,
  ) {}

  async register(dto: RegisterDto): Promise<RegisterResponseDto> {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (existing) {
      throw new ConflictException('Email already registered');
    }

    const passwordHash = await argon2.hash(dto.password);

    const { user, account } = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { email: dto.email, passwordHash, role: Role.USER },
      });
      const account = await this.accounts.createForUser(
        user.id,
        DEFAULT_CURRENCY,
        tx,
      );
      return { user, account };
    });

    return {
      accessToken: this.signToken({ sub: user.id, role: user.role }),
      userId: user.id,
      accountNumber: account.accountNumber,
    };
  }

  async onModuleInit() {
    this.dummyHash = await argon2.hash(randomBytes(32).toString('hex'));
  }

  async login(dto: LoginDto): Promise<AuthResponseDto> {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    // Verify against a throwaway hash when the email is unknown, so both paths
    // cost the same and cannot be told apart by response time.
    const passwordMatches = await argon2.verify(
      user?.passwordHash ?? this.dummyHash,
      dto.password,
    );

    if (!user || !passwordMatches) {
      throw new UnauthorizedException('Invalid credentials');
    }

    return {
      accessToken: this.signToken({ sub: user.id, role: user.role }),
    };
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { accounts: { orderBy: { accountNumber: 'asc' } } },
    });

    return {
      id: user.id,
      email: user.email,
      role: user.role,
      createdAt: user.createdAt,
      accounts: user.accounts.map(AccountResponseDto.from),
    };
  }

  private signToken(payload: JwtPayload): string {
    return this.jwt.sign(payload);
  }
}
