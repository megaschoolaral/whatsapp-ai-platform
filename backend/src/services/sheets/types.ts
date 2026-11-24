export interface Slot {
  /** YYYY-MM-DD */
  date: string;
  /** HH:mm */
  time: string;
  /** 1-based row number in the sheet */
  row: number;
  free: boolean;
}
