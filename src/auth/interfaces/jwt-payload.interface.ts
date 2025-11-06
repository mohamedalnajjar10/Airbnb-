import { Role } from '../../common/enums/role.enum';
import { UserType } from '../../common/enums/user-type.enum';
export interface JwtPayload {
    sub: string;
    mobile: string;
    roles: Role[];
    type: UserType;
    guest?: boolean;
}

