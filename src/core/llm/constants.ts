export const DEFAULT_MODELS = {
  text: 'deepseek-v4-pro',
  image: 'unsupported-image',
  music: 'unsupported-music',
  video: 'unsupported-video'
} as const;

export const AVAILABLE_MODELS = {
  text: [
    'deepseek-v4-pro',
    'deepseek-v4-flash'
  ],
  image: [],
  music: [],
  video: []
} as const;

export type ModelType = keyof typeof AVAILABLE_MODELS;
