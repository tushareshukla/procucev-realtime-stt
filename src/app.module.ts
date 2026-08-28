import { Module } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import { TypeOrmModule } from '@nestjs/typeorm';
import { join } from 'path';

import { HealthController } from './health.controller';
import { IndexController } from './index.controller';
import { Session } from './session/session.entity';
import { SessionController } from './session/session.controller';
import { SessionService } from './session/session.service';
import { MastraController } from './mastra/mastra.controller';
import { MastraService } from './mastra/mastra.service';
import { SttService } from './stt/stt.service';
import { TtsController } from './tts/tts.controller';
import { TtsService } from './tts/tts.service';
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
            entities: [Transcription, Session],
            synchronize: true,
            ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
          }
        : {
            type: 'better-sqlite3',
            database: process.env.SQLITE_PATH ?? './transcriptions.db',
            entities: [Transcription, Session],
            synchronize: true,
          },
    ),
    TypeOrmModule.forFeature([Transcription, Session]),
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', 'public'),
      // API routes must never fall through to the static handler, and the app
      // shell must not be served straight off disk — IndexController stamps a
      // build id into it. Without index:false the middleware answers "/" first
      // and the placeholder ships unsubstituted.
      exclude: ['/api/{*splat}', '/healthz', '/readyz'],
      serveStaticOptions: {
        index: false,
        // The UI is a handful of small files that change on every deploy.
        // Without this browsers keep serving a stale app.js after a release,
        // which looks exactly like the new code being broken.
        setHeaders: (res, path) => {
          if (/\.(html|js|css)$/.test(path)) {
            res.setHeader('Cache-Control', 'no-cache, must-revalidate');
          }
        },
      },
    }),
  ],
  controllers: [IndexController, HealthController, SessionController, TranscriptionController, TtsController, MastraController],
  providers: [SessionService, TranscriptionService, SttService, TtsService, TranscriptionGateway, MastraService],
})
export class AppModule {}
