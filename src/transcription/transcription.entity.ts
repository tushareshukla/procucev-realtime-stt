import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('transcriptions')
export class Transcription {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @Column({ length: 64 })
  sessionId: string;

  @Column({ type: 'text' })
  text: string;

  /** Whisper's detected language, or 'mixed' when the segment code-switches. */
  @Column({ length: 16, default: '' })
  language: string;

  /** exp(mean logprob) — a rough confidence, useful for flagging bad segments. */
  @Column({ type: 'float', default: 0 })
  confidence: number;

  @Column({ type: 'float', default: 0 })
  durationS: number;

  /**
   * The recording itself, base64-encoded, so a saved item can be replayed after
   * a reload. Stored as text rather than bytea/blob so the same schema works on
   * both Postgres and the SQLite dev fallback. `select: false` keeps it out of
   * list queries — it is only loaded when the audio is actually requested.
   */
  @Column({ type: 'text', nullable: true, select: false })
  audio?: string;

  @Column({ type: 'boolean', default: false })
  hasAudio: boolean;

  @CreateDateColumn()
  createdAt: Date;
}
