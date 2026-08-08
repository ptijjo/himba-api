import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  User,
  UserRole,
  UserStatus,
} from '../generated/prisma/client';
import {
  parsePage,
  parsePageLimit,
  pageSkip,
  toPageResult,
} from '../common/pagination/page.dto';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { UpdateProfileDto } from './dto/update-profile.dto';

export type PublicUser = Omit<User, 'passwordHash'>;

export type AdminUserListItem = PublicUser & {
  artistId: string | null;
};

export type AdminUsersListResponse = {
  items: AdminUserListItem[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

/** Profil visible par un autre compte — jamais email / hash / status. */
export type UserPublicProfile = {
  id: string;
  username: string;
  bio: string | null;
  avatarUrl: string | null;
  artistId: string | null;
};

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });
  }

  findByUsername(username: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { username } });
  }

  /** Login = email (insensible à la casse) ou pseudo exact. */
  async findByLogin(login: string): Promise<User | null> {
    const normalized = login.trim();
    const byEmail = await this.prisma.user.findUnique({
      where: { email: normalized.toLowerCase() },
    });
    if (byEmail) {
      return byEmail;
    }
    return this.prisma.user.findUnique({ where: { username: normalized } });
  }

  async getMe(userId: string): Promise<PublicUser> {
    const user = await this.findById(userId);
    if (!user) {
      throw new NotFoundException('Utilisateur introuvable');
    }
    return this.toPublic(user);
  }

  /**
   * Profil public d’un autre utilisateur (auth requise au niveau guard).
   * 1. Charger username / bio / avatar / artistId uniquement
   * 2. Masquer les comptes BANNED (404)
   */
  async getPublicProfile(userId: string): Promise<UserPublicProfile> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        bio: true,
        avatarUrl: true,
        status: true,
        artist: { select: { id: true } },
      },
    });
    if (!user || user.status === 'BANNED') {
      throw new NotFoundException('Utilisateur introuvable');
    }
    return {
      id: user.id,
      username: user.username,
      bio: user.bio,
      avatarUrl: this.storage.resolvePublicUrl(user.avatarUrl),
      artistId: user.artist?.id ?? null,
    };
  }

  async updateMe(
    userId: string,
    dto: UpdateProfileDto,
    avatar?: Express.Multer.File,
  ): Promise<PublicUser> {
    const data: {
      bio?: string | null;
      avatarUrl?: string;
      username?: string;
    } = {};
    if (dto.bio !== undefined) {
      data.bio = dto.bio;
    }
    if (dto.username !== undefined) {
      const username = dto.username.trim();
      const current = await this.findById(userId);
      if (!current) {
        throw new NotFoundException('Utilisateur introuvable');
      }
      if (username !== current.username) {
        // 1. Unicité (hors soi-même) · 2. Appliquer le nouveau pseudo
        const taken = await this.findByUsername(username);
        if (taken && taken.id !== userId) {
          throw new ConflictException('Nom d’utilisateur déjà utilisé');
        }
        data.username = username;

        // Si le nom d’artiste était encore égal à l’ancien pseudo → le suivre
        const artist = await this.prisma.artist.findUnique({
          where: { userId },
          select: { id: true, displayName: true },
        });
        if (artist && artist.displayName === current.username) {
          await this.prisma.artist.update({
            where: { id: artist.id },
            data: { displayName: username },
          });
        }
      }
    }
    if (avatar) {
      const uploaded = await this.storage.uploadImage(
        avatar,
        'avatar',
        `avatars/${userId}`,
      );
      data.avatarUrl =
        uploaded.publicUrl ?? `r2://${uploaded.objectKey}`;
    }

    const user = await this.prisma.user.update({
      where: { id: userId },
      data,
    });
    return this.toPublic(user);
  }

  async setRole(userId: string, role: UserRole): Promise<User> {
    return this.prisma.user.update({
      where: { id: userId },
      data: { role },
    });
  }

  toPublic(user: User): PublicUser {
    const { passwordHash: _passwordHash, avatarUrl, ...rest } = user;
    return {
      ...rest,
      avatarUrl: this.storage.resolvePublicUrl(avatarUrl),
    };
  }

  async assertUsernameAvailable(username: string): Promise<void> {
    const existing = await this.findByUsername(username);
    if (existing) {
      throw new ConflictException('Nom d’utilisateur déjà utilisé');
    }
  }

  /**
   * Liste ADMIN — sans passwordHash ; filtres q / role / status.
   */
  async listForAdmin(query: {
    page?: number;
    limit?: number;
    q?: string;
    role?: UserRole;
    status?: UserStatus;
  }): Promise<AdminUsersListResponse> {
    const page = parsePage(query.page);
    const limit = parsePageLimit(query.limit);
    const skip = pageSkip(page, limit);
    const q = query.q?.trim();

    const where: Prisma.UserWhereInput = {
      ...(query.role ? { role: query.role } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(q
        ? {
            OR: [
              { email: { contains: q, mode: 'insensitive' } },
              { username: { contains: q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          artist: { select: { id: true } },
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    return toPageResult(
      rows.map((row) => {
        const { artist, ...user } = row;
        return {
          ...this.toPublic(user),
          artistId: artist?.id ?? null,
        };
      }),
      total,
      page,
      limit,
    );
  }

  /**
   * Modération ADMIN — statut / rôle (pas de promotion ADMIN).
   * Les comptes ADMIN seedés sont protégés.
   */
  async updateForAdmin(
    id: string,
    data: { status?: UserStatus; role?: UserRole },
  ): Promise<AdminUserListItem> {
    const existing = await this.prisma.user.findUnique({
      where: { id },
      include: { artist: { select: { id: true } } },
    });
    if (!existing) {
      throw new NotFoundException('Utilisateur introuvable');
    }
    if (existing.role === UserRole.ADMIN) {
      throw new ForbiddenException(
        'Le compte administrateur seedé ne peut pas être modifié ici',
      );
    }
    if (!data.status && !data.role) {
      throw new BadRequestException('Aucun champ à mettre à jour');
    }
    if (data.role === UserRole.ADMIN) {
      throw new ForbiddenException(
        'Impossible d’attribuer le rôle ADMIN depuis le back-office',
      );
    }

    const updated = await this.prisma.user.update({
      where: { id },
      data: {
        ...(data.status ? { status: data.status } : {}),
        ...(data.role ? { role: data.role } : {}),
      },
      include: { artist: { select: { id: true } } },
    });

    const { artist, ...user } = updated;
    return {
      ...this.toPublic(user),
      artistId: artist?.id ?? null,
    };
  }

  /** Suppression ADMIN — cascade Prisma ; comptes ADMIN protégés. */
  async deleteForAdmin(id: string): Promise<{ message: string }> {
    const existing = await this.prisma.user.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Utilisateur introuvable');
    }
    if (existing.role === UserRole.ADMIN) {
      throw new ForbiddenException(
        'Le compte administrateur seedé ne peut pas être supprimé',
      );
    }
    await this.prisma.user.delete({ where: { id } });
    return {
      message: `Compte « ${existing.username} » supprimé.`,
    };
  }
}
