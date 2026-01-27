import { UserRole, UserType } from '@prisma/client';

export interface JwtPayload {
    sub: string;
    mobile: string;
    role: UserRole;
    type: UserType;
    guest?: boolean;
}

