
export enum VoiceName {
  Puck = 'Puck',
  Charon = 'Charon',
  Kore = 'Kore',
  Fenrir = 'Fenrir',
  Zephyr = 'Zephyr',
}

export interface ScriptLine {
  speaker: string;
  text: string;
}

export interface RssArticle {
  title: string;
  description: string;
  link: string;
  source: string;
}

export interface GeneratedScriptResponse {
  title: string;
  script: string; // Raw text format for display/editing
  searchSources?: { title: string; uri: string }[];
}

export interface SpeakerConfig {
  name: string; // e.g., "Host", "Guest"
  voice: VoiceName;
}

// We use indices 0, 1, 2 for Music A, B, C. -1 means None.
export type MusicSlotIndex = -1 | 0 | 1 | 2;

export interface StoredAudioFile {
  name: string;
  blob: Blob;
}
