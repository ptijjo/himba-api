import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Artist, UserRole } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { UsersService } from '../users/users.service';
import { BecomeArtistDto } from './dto/become-artist.dto';
import { UpdateArtistDto } from './dto/update-artist.dto';

@Injectable()
export class ArtistsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
    private readonly storage: StorageService,
  ) {}

  async become(
    userId: string,
    dto: BecomeArtistDto,
  ): Promise<Artist> {
    const existing = await this.prisma.artist.findUnique({
      where: { userId },
    });
    if (existing) {
      throw new ConflictException('Profil artiste déjà créé');
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('Utilisateur introuvable');
    }

    // 1. Créer Artist ; 2. LISTENER → ARTIST (ADMIN conserve son rôle)
    const artist = await this.prisma.$transaction(async (tx) => {
      const created = await tx.artist.create({
        data: {
          userId,
          displayName: dto.displayName.trim(),
          bio: dto.bio,
        },
      });
      if (user.role === UserRole.LISTENER) {
        await tx.user.update({
          where: { id: userId },
          data: { role: UserRole.ARTIST },
        });
      }
      return created;
    });

    return artist;
  }

  async findById(id: string): Promise<Artist> {
    const artist = await this.prisma.artist.findUnique({ where: { id } });
    if (!artist) {
      throw new NotFoundException('Artiste introuvable');
    }
    return artist;
  }

  async findByUserId(userId: string): Promise<Artist | null> {
    return this.prisma.artist.findUnique({ where: { userId } });
  }

  async update(
    artistId: string,
    actor: { id: string; role: UserRole },
    dto: UpdateArtistDto,
    cover?: Express.Multer.File,
  ): Promise<Artist> {
    const artist = await this.findById(artistId);
    this.assertOwnerOrAdmin(artist, actor);

    const data: {
      displayName?: string;
      bio?: string | null;
      coverUrl?: string;
    } = {};
    if (dto.displayName !== undefined) {
      data.displayName = dto.displayName.trim();
    }
    if (dto.bio !== undefined) {
      data.bio = dto.bio;
    }
    if (cover) {
      const uploaded = await this.storage.uploadImage(
        cover,
        'cover',
        `artists/${artistId}`,
      );
      data.coverUrl = uploaded.publicUrl ?? `r2://${uploaded.objectKey}`;
    }

    return this.prisma.artist.update({
      where: { id: artistId },
      data,
    });
  }

  assertOwnerOrAdmin(
    artist: Artist,
    actor: { id: string; role: UserRole },
  ): void {
    if (actor.role === UserRole.ADMIN) {
      return;
    }
    if (artist.userId !== actor.id) {
      throw new ForbiddenException('Artiste non propriétaire');
    }
  }
}
