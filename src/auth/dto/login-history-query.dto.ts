import { CursorPaginationQueryDto } from '../../common/pagination/cursor.dto';

/** Query GET /auth/login-history — cursor + limit (défaut 20, max 50). */
export class LoginHistoryQueryDto extends CursorPaginationQueryDto {}
