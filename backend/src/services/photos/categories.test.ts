import { describe, expect, it } from 'vitest';
import { PHOTO_CATEGORIES, isPhotoCategory } from './categories.js';

describe('photo categories', () => {
  it('has 8 unique categories', () => {
    const ids = PHOTO_CATEGORIES.map((c) => c.id);
    expect(ids).toHaveLength(8);
    expect(new Set(ids).size).toBe(8);
  });

  it('accepts known ids', () => {
    expect(isPhotoCategory('room_4')).toBe(true);
  });

  it('rejects unknown ids', () => {
    expect(isPhotoCategory('room_3')).toBe(false);
    expect(isPhotoCategory('')).toBe(false);
  });
});
