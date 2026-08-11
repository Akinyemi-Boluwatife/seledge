import { Request } from 'express';
import { Role } from '../../generated/prisma/enums';

export interface AuthenticatedUser {
  userId: string;
  role: Role;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
}
