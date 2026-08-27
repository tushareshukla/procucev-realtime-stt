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

  @CreateDateColumn()
  createdAt: Date;
}
