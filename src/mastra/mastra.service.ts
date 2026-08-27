import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { TranscriptionService } from '../transcription/transcription.service';
import { buildTranscriptAgent } from './transcript.agent';

@Injectable()
export class MastraService {
  private readonly log = new Logger(MastraService.name);
  private readonly mastra: ReturnType<typeof buildTranscriptAgent>;

  constructor(private readonly transcriptions: TranscriptionService) {
    this.mastra = buildTranscriptAgent(transcriptions);
    if (!this.mastra) {
      this.log.warn(
        'GOOGLE_GENERATIVE_AI_API_KEY unset — Mastra agent endpoints disabled ' +
          '(speech-to-text is unaffected)',
      );
    }
  }

  get enabled(): boolean {
    return Boolean(this.mastra);
  }

  async ask(prompt: string): Promise<string> {
    if (!this.mastra) {
      throw new ServiceUnavailableException(
        'Mastra agent is not configured; set GOOGLE_GENERATIVE_AI_API_KEY',
      );
    }
    const agent = this.mastra.getAgent('transcriptAgent');
    const result = await agent.generate(prompt);
    return result.text;
  }

  cleanup(sessionId: string): Promise<string> {
    return this.ask(
      `Fetch the transcript for session ${sessionId}, then return it cleaned up: ` +
        'fix punctuation and obvious mis-hearings only. Preserve the original ' +
        'language mix and script exactly.',
    );
  }

  summarize(sessionId: string): Promise<string> {
    return this.ask(
      `Fetch the transcript for session ${sessionId} and summarise what was said ` +
        'in 3 bullet points. Reply in the same language mix the speaker used.',
    );
  }
}
