import { Column, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * Persisted sessions.
 *
 * Kept in the database as well as in memory so a restart or deploy does not
 * sign everyone out — the in-memory map is a cache, this is the source of truth.
 */
@Entity('sessions')
export class Session {
  /** Opaque id held in an httpOnly cookie. */
  @PrimaryColumn({ length: 64 })
  id: string;

  @Index()
  @Column({ length: 80 })
  userName: string;

  @UpdateDateColumn()
  lastSeen: Date;
}
