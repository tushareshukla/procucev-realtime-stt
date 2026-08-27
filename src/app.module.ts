import { Module } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import { TypeOrmModule } from '@nestjs/typeorm';
import { join } from 'path';

import { HealthController } from './health.controller';
import { MastraController } from './mastra/mastra.controller';
import { MastraService } from './mastra/mastra.service';
import { SttService } from './stt/stt.service';
import { Transcription } from './transcription/transcription.entity';
import { TranscriptionController } from './transcription/transcription.controller';
import { TranscriptionGateway } from './transcription/transcription.gateway';
import { TranscriptionService } from './transcription/transcription.service';

/**
 * DATABASE_URL selects the store. SQLite is the local default; setting a
 * postgres:// URL switches dialects with no code change, which is how this
 * moves to Cloud SQL / Neon for deployment.
 */
const databaseUrl = process.env.DATABASE_URL ?? '';
const usePostgres = databaseUrl.startsWith('postgres');

@Module({
  imports: [
    TypeOrmModule.forRoot(
      usePostgres
        ? {
            type: 'postgres',
            url: databaseUrl,
            entities: [Transcription],
            synchronize: true,
            ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
          }
        : {
            type: 'better-sqlite3',
            database: process.env.SQLITE_PATH ?? './transcriptions.db',
            entities: [Transcription],
            synchronize: true,
          },
    ),
    TypeOrmModule.forFeature([Transcription]),
    ServeStaticModule.forRoot({ rootPath: join(__dirname, '..', 'public') }),
  ],
  controllers: [HealthController, TranscriptionController, MastraController],
  providers: [TranscriptionService, SttService, TranscriptionGateway, MastraService],
})
export class AppModule {}
