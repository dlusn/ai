export type SpeechProvider = 'deepgram' | 'elevenlabs' | 'cartesia' | 'stub';

/** Audio in, as bytes plus the media type the vendor needs to see. */
export type SpeechAudio = {
  data: Uint8Array | ArrayBuffer | Blob;
  mime: string;
};

export type TranscribeOptions = {
  /** Overrides SPEECH_STT_PROVIDER for one call. */
  provider?: SpeechProvider;
  /** Overrides SPEECH_STT_MODEL for one call. */
  model?: string;
  language?: string;
  /**
   * Keyterm boosting. Always supplied by the caller, never a constant in this
   * package, because the terms are product vocabulary.
   */
  keyterms?: string[];
  diarize?: boolean;
  punctuate?: boolean;
  signal?: AbortSignal;
};

export type Transcript = {
  text: string;
  provider: string;
  model: string;
  language?: string;
  durationSeconds?: number;
};

/** A voice id, or the id plus per call overrides. */
export type Voice =
  | string
  | {
      id: string;
      provider?: SpeechProvider;
      model?: string;
      /** Output container, for example mp3 or wav. Vendor default when unset. */
      format?: string;
      speed?: number;
      language?: string;
      signal?: AbortSignal;
    };

export type Synthesis = {
  audio: Uint8Array;
  mime: string;
  provider: string;
  model: string;
  voiceId: string;
};
