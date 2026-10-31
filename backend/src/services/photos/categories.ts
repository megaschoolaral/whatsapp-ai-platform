export const PHOTO_CATEGORIES = [
  { id: 'kitchen', label: 'Кухня' },
  { id: 'bathroom', label: 'Ванная' },
  { id: 'lounge', label: 'Зона отдыха' },
  { id: 'room_2', label: '2-местный номер' },
  { id: 'room_4', label: '4-местный номер' },
  { id: 'room_6', label: '6-местный номер' },
  { id: 'room_8', label: '8-местный номер' },
  { id: 'room_10', label: '10-местный номер' },
] as const;

export type PhotoCategoryId = (typeof PHOTO_CATEGORIES)[number]['id'];

export const MAX_PHOTOS_PER_CATEGORY = 10;
export const MAX_CATEGORIES_PER_REPLY = 2;

export function isPhotoCategory(v: string): v is PhotoCategoryId {
  return PHOTO_CATEGORIES.some((c) => c.id === v);
}
