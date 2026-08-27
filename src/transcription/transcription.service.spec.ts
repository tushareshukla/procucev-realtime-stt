import { NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Transcription } from './transcription.entity';
import { TranscriptionService } from './transcription.service';

describe('TranscriptionService (in-memory sqlite)', () => {
  let ds: DataSource;
  let service: TranscriptionService;

  beforeEach(async () => {
    ds = new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      entities: [Transcription],
      synchronize: true,
    });
    await ds.initialize();
    service = new TranscriptionService(ds.getRepository(Transcription));
  });

  afterEach(async () => {
    if (ds?.isInitialized) await ds.destroy();
  });

  const seed = (over: Partial<Transcription> = {}) =>
    service.create({
      sessionId: 'sess-1',
      text: 'मैं कल office जाऊंगा',
      language: 'hi',
      confidence: 0.9,
      durationS: 3.2,
      ...over,
    });

  it('persists a transcription and assigns an id', async () => {
    const row = await seed();
    expect(row.id).toBeGreaterThan(0);
    expect(row.createdAt).toBeInstanceOf(Date);
  });

  // The whole point of the service: Devanagari and Latin in one string.
  it('round-trips code-mixed Hinglish without mangling either script', async () => {
    const text = 'मैं कल office जाऊंगा और client के साथ meeting attend करूंगा';
    const saved = await seed({ text });
    const found = await service.findOne(saved.id);
    expect(found.text).toBe(text);
  });

  it('lists newest first', async () => {
    await seed({ text: 'first' });
    await seed({ text: 'second' });
    const all = await service.findAll();
    expect(all[0].text).toBe('second');
  });

  it('respects the limit', async () => {
    for (let i = 0; i < 5; i++) await seed({ text: `t${i}` });
    expect(await service.findAll(3)).toHaveLength(3);
  });

  it('caps the limit at 500 to avoid unbounded reads', async () => {
    await seed();
    expect(await service.findAll(10_000)).toHaveLength(1);
  });

  it('updates the text', async () => {
    const row = await seed();
    const updated = await service.update(row.id, 'corrected text');
    expect(updated.text).toBe('corrected text');
    expect((await service.findOne(row.id)).text).toBe('corrected text');
  });

  it('deletes', async () => {
    const row = await seed();
    await service.remove(row.id);
    await expect(service.findOne(row.id)).rejects.toThrow(NotFoundException);
  });

  it('throws NotFound rather than returning null for a missing id', async () => {
    await expect(service.findOne(9999)).rejects.toThrow(NotFoundException);
    await expect(service.update(9999, 'x')).rejects.toThrow(NotFoundException);
    await expect(service.remove(9999)).rejects.toThrow(NotFoundException);
  });

  it('groups a session in spoken order for the agent to read', async () => {
    await seed({ sessionId: 'a', text: 'one' });
    await seed({ sessionId: 'b', text: 'other session' });
    await seed({ sessionId: 'a', text: 'two' });
    const rows = await service.findBySession('a');
    expect(rows.map((r) => r.text)).toEqual(['one', 'two']);
  });
});
