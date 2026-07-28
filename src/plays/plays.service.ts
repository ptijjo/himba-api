import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePlayDto } from './dto/create-play.dto';

@Injectable()
export class PlaysService {
  constructor(private readonly prisma: PrismaService) {}

  async record(userId: string, dto: CreatePlayDto) {
    const track = await this.prisma.track.findUnique({
      where: { id: dto.trackId },
    });
    if (!track) {
      throw new NotFoundException('Titre introuvable');
    }
    return this.prisma.playEvent.create({
      data: {
        userId,
        trackId: dto.trackId,
        progressMs: dto.progressMs,
      },
    });
  }
}
