import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { Repository } from 'typeorm';
import { Session } from './session.entity';

/**
 * Sessions mapping an opaque cookie to a user name.
 *
 * In-memory for speed, persisted so a restart does not sign everyone out.
 * Identity deliberately never lives in browser storage — the client holds only
 * an opaque id and cannot claim to be someone else by editing it.
 */
@Injectable()
export class SessionService implements OnModuleInit {
  private readonly cache = new Map<string, { userName: string; lastSeen: number }>();
  private readonly ttlMs = Number(process.env.SESSION_TTL_MS ?? 30 * 24 * 60 * 60 * 1000);

  constructor(@InjectRepository(Session) private readonly repo: Repository<Session>) {}

  /** Warm the cache so the first request after a restart is not a cache miss. */
  async onModuleInit(): Promise<void> {
    try {
      for (const s of await this.repo.find({ take: 5000 })) {
        this.cache.set(s.id, { userName: s.userName, lastSeen: s.lastSeen?.getTime() ?? Date.now() });
      }
    } catch {
      /* table may not exist yet on first boot; synchronize creates it */
    }
  }

  async create(userName: string): Promise<string> {
    const id = randomUUID();
    await this.remember(id, userName);
    return id;
  }

  async remember(id: string, userName: string): Promise<void> {
    const clean = userName.trim().slice(0, 80);
    this.cache.set(id, { userName: clean, lastSeen: Date.now() });
    await this.repo.save({ id, userName: clean }).catch(() => undefined);
  }

  async resolve(id?: string): Promise<string | null> {
    if (!id) return null;

    const hit = this.cache.get(id);
    if (hit) {
      if (Date.now() - hit.lastSeen > this.ttlMs) {
        this.cache.delete(id);
        await this.repo.delete({ id }).catch(() => undefined);
        return null;
      }
      hit.lastSeen = Date.now();
      return hit.userName;
    }

    // Cache miss: the process restarted but the session is still valid.
    const row = await this.repo.findOneBy({ id }).catch(() => null);
    if (!row) return null;
    this.cache.set(id, { userName: row.userName, lastSeen: Date.now() });
    return row.userName;
  }

  /** Read our cookie without pulling in a parser dependency. */
  static readCookie(header: string | undefined, name: string): string | undefined {
    if (!header) return undefined;
    for (const part of header.split(';')) {
      const [k, ...rest] = part.trim().split('=');
      if (k === name) return decodeURIComponent(rest.join('='));
    }
    return undefined;
  }
}
