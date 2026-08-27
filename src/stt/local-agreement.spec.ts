import { LocalAgreement } from './local-agreement';

describe('LocalAgreement', () => {
  it('commits nothing from a single hypothesis', () => {
    const la = new LocalAgreement();
    const r = la.update('मैं कल ऑफिस');
    expect(r.committed).toBe('');
    expect(r.tentative).toBe('मैं कल ऑफिस');
  });

  it('commits the prefix two consecutive hypotheses agree on', () => {
    const la = new LocalAgreement();
    la.update('मैं कल ऑफिस');
    const r = la.update('मैं कल ऑफिस जाऊंगा');
    expect(r.committed).toBe('मैं कल ऑफिस');
    expect(r.tentative).toBe('जाऊंगा');
  });

  // The point of the whole class: once a word is committed it must survive,
  // even if a later pass changes its mind about that position.
  it('never retracts a committed word when a later pass revises it', () => {
    const la = new LocalAgreement();
    la.update('the quarterly report');
    la.update('the quarterly report is');   // commits "the quarterly report"
    const r = la.update('the quarterly umbrella is due');

    expect(r.committed.startsWith('the quarterly report')).toBe(true);
    expect(r.committed).not.toContain('umbrella');
  });

  it('grows the committed prefix as agreement extends', () => {
    const la = new LocalAgreement();
    la.update('one two');
    la.update('one two three');
    expect(la.update('one two three four').committed).toBe('one two three');
  });

  // Whisper varies casing and punctuation between passes; that must not stop
  // a word from being recognised as agreed. Which variant is kept is arbitrary.
  it('treats punctuation and case drift as agreement', () => {
    const la = new LocalAgreement();
    la.update('The quarterly report');
    const r = la.update('the quarterly, report is');

    const words = r.committed.toLowerCase().replace(/[.,]/g, '').split(/\s+/);
    expect(words).toEqual(['the', 'quarterly', 'report']);
  });

  it('exposes the full text as committed plus tail', () => {
    const la = new LocalAgreement();
    la.update('one two');
    la.update('one two three');
    expect(la.text).toBe('one two three');
  });

  it('handles an empty hypothesis without throwing', () => {
    const la = new LocalAgreement();
    expect(la.update('').committed).toBe('');
    expect(la.update('  ').tentative).toBe('');
  });

  it('resets cleanly between utterances', () => {
    const la = new LocalAgreement();
    la.update('one two');
    la.update('one two');
    la.reset();
    expect(la.update('different').committed).toBe('');
  });
});
