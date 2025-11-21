
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

export interface GeneratedScriptResponse {
  title: string;
  script: string; // Raw text format for display/editing
  searchSources?: { title: string; uri: string }[];
}

export interface SpeakerConfig {
  name: string; // e.g., "Host", "Guest"
  voice: VoiceName;
}

export type BackgroundMusicPreset = 'none' | 'chill' | 'news';
