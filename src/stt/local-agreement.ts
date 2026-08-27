/**
 * LocalAgreement-2 stabilisation for streaming transcription.
 *
 * Whisper re-transcribes a growing buffer, and each pass may revise earlier
 * words — so naive partials flicker and rewrite themselves as you speak.
 *
 * LocalAgreement-2 (Liu et al., as used by whisper_streaming) fixes this:
 * a word is only *committed* once two consecutive hypotheses agree on it.
 * Committed text never changes again; only the unstable tail after it moves.
 * The user sees text settle left-to-right instead of jittering.
 */
export class LocalAgreement {
  private committed: string[] = [];
  private previous: string[] = [];

  /**
   * Feed the newest full-buffer hypothesis.
   * @returns committed prefix (stable) and tentative tail (may still change)
   */
  update(hypothesis: string): { committed: string; tentative: string } {
    const words = tokenize(hypothesis);

    // How far do the last two hypotheses agree, beyond what is already committed?
    let agreed = this.committed.length;
    while (
      agreed < words.length &&
      agreed < this.previous.length &&
      normalize(words[agreed]) === normalize(this.previous[agreed])
    ) {
      agreed++;
    }

    // Append only. Assigning words.slice(0, agreed) would silently rewrite
    // already-committed words with the newest pass's wording, which is exactly
    // the flicker this class exists to prevent.
    if (agreed > this.committed.length) {
      this.committed = this.committed.concat(words.slice(this.committed.length, agreed));
    }
    this.previous = words;

    return {
      committed: this.committed.join(' '),
      tentative: words.slice(this.committed.length).join(' '),
    };
  }

  /** Full text as currently known, stable prefix plus tail. */
  get text(): string {
    return [this.committed.join(' '), this.previous.slice(this.committed.length).join(' ')]
      .filter(Boolean)
      .join(' ')
      .trim();
  }

  reset(): void {
    this.committed = [];
    this.previous = [];
  }
}

function tokenize(text: string): string[] {
  return (text || '').trim().split(/\s+/).filter(Boolean);
}

/** Compare ignoring punctuation and case — Whisper varies both between passes. */
function normalize(word: string): string {
  return word.toLowerCase().replace(/[.,!?;:।"'`]/g, '');
}
