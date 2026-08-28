import { Agent } from '@mastra/core/agent';
import { createTool } from '@mastra/core/tools';
import { Mastra } from '@mastra/core';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { z } from 'zod';
import type { TranscriptionService } from '../transcription/transcription.service';

/**
 * Mastra agent that reasons over stored transcripts.
 *
 * The STT path never touches an LLM — Whisper runs locally and its output is
 * saved verbatim. This agent is a separate, optional layer for cleanup and
 * Q&A over transcription history.
 */
export function buildTranscriptAgent(transcriptions: TranscriptionService) {
  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!apiKey) return null;

  const google = createGoogleGenerativeAI({ apiKey });

  const getSessionTranscript = createTool({
    id: 'get-session-transcript',
    description:
      'Fetch every committed transcript segment for one recording session, in order.',
    inputSchema: z.object({
      sessionId: z.string().describe('The session id returned when recording started'),
    }),
    outputSchema: z.object({
      segments: z.array(
        z.object({ id: z.number(), text: z.string(), language: z.string() }),
      ),
    }),
    execute: async ({ context }) => {
      const rows = await transcriptions.findBySession(context.sessionId);
      return {
        segments: rows.map((r) => ({ id: r.id, text: r.text, language: r.language })),
      };
    },
  });

  const listRecent = createTool({
    id: 'list-recent-transcriptions',
    description: 'List the most recent transcript segments across all sessions.',
    inputSchema: z.object({ limit: z.number().default(20) }),
    outputSchema: z.object({
      segments: z.array(
        z.object({ id: z.number(), text: z.string(), sessionId: z.string() }),
      ),
    }),
    execute: async ({ context }) => {
      const rows = await transcriptions.findAll(context.limit);
      return {
        segments: rows.map((r) => ({ id: r.id, text: r.text, sessionId: r.sessionId })),
      };
    },
  });

  const agent = new Agent({
    name: 'transcript-agent',
    instructions: [
      'You work with real-time speech transcripts that are frequently code-mixed',
      'Hindi and English (Hinglish), transcribed by Whisper.',
      '',
      'When cleaning a transcript: fix punctuation and obvious mis-hearings, but',
      'NEVER translate. If the speaker mixed Hindi and English, the cleaned text',
      'must stay mixed — collapsing it into one language destroys the meaning the',
      'speaker intended.',
      '',
      'Whisper transcribes Hindi in Devanagari by default. Preserve whatever',
      'script the transcript already uses; do not transliterate between them.',
      'Never invent content that is not in the transcript.',
    ].join('\n'),
    // gemini-2.5-flash is closed to new API keys ("no longer available to
    // new users"), so a fresh deployment must not default to it.
    model: google(process.env.MASTRA_MODEL ?? 'gemini-3.6-flash'),
    tools: { getSessionTranscript, listRecent },
  });

  return new Mastra({ agents: { transcriptAgent: agent } });
}
