import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { User, UserRole } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { UpdateProfileDto } from './dto/update-profile.dto';

export type PublicUser = Omit<User, 'passwordHash'>;

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

  async updateMe(
    userId: string,
    dto: UpdateProfileDto,
    avatar?: Express.Multer.File,
  ): Promise<PublicUser> {
    const data: { bio?: string | null; avatarUrl?: string } = {};
    if (dto.bio !== undefined) {
      data.bio = dto.bio;
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
    const { passwordHash: _passwordHash, ...rest } = user;
    return rest;
  }

  async assertUsernameAvailable(username: string): Promise<void> {
    const existing = await this.findByUsername(username);
    if (existing) {
      throw new ConflictException('Nom d’utilisateur déjà utilisé');
    }
  }
}
