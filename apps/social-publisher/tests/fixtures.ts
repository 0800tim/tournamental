import type { ClipReady } from '../src/types.js';

export function makeClip(overrides: Partial<ClipReady> = {}): ClipReady {
  return {
    clipId: 'clip_test_001',
    paths: {
      v9x16: '/clips/clip_test_001_9x16.mp4',
      v16x9: '/clips/clip_test_001_16x9.mp4',
      v1x1: '/clips/clip_test_001_1x1.mp4',
      og: '/clips/clip_test_001_og.png',
    },
    captions: {
      en: 'Goal! Test caption in English.',
      es: 'Gol! Caption en español.',
    },
    hashtags: ['#Test', '#WorldCup2026'],
    tournamentId: 'fifa-wc-2022',
    matchId: 'fifa-wc-2022-final-arg-fra',
    eventType: 'goal',
    ...overrides,
  };
}
