import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Transcription } from './transcription.entity';

@Injectable()
export class TranscriptionService {
  constructor(
    @InjectRepository(Transcription)
    private readonly repo: Repository<Transcription>,
  ) {}

  create(data: Partial<Transcription>): Promise<Transcription> {
    return this.repo.save(this.repo.create(data));
  }

  findAll(limit = 100): Promise<Transcription[]> {
    return this.repo.find({ order: { id: 'DESC' }, take: Math.min(limit, 500) });
  }

  async findOne(id: number): Promise<Transcription> {
    const row = await this.repo.findOneBy({ id });
    if (!row) throw new NotFoundException(`transcription ${id} not found`);
    return row;
  }

  async update(id: number, text: string): Promise<Transcription> {
    const row = await this.findOne(id);
    row.text = text;
    return this.repo.save(row);
  }

  async remove(id: number): Promise<void> {
    const row = await this.findOne(id);
    await this.repo.remove(row);
  }

  findBySession(sessionId: string): Promise<Transcription[]> {
    return this.repo.find({ where: { sessionId }, order: { id: 'ASC' } });
  }
}
