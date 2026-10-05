// 辨識結果的每一列要帶入哪個座位。
// 先用名字對應（模型比對同音字、異體字後給的 match），剩下對不上的列再照成績卡順序填進還空著的座位。

export interface RecognizedRow {
  /** 對應到這一組名單的第幾位（0 起算）；對不上名字時為 null */
  match?: number | null;
}

/**
 * @param seatCount 這一組的座位數（名單順序 = 座位順序）
 * @returns 每個座位要用辨識結果的第幾列；-1 = 不套用
 */
export function defaultMapping(seatCount: number, rows: RecognizedRow[]): { rowOfSeat: number[]; byName: boolean[] } {
  const rowOfSeat = new Array<number>(seatCount).fill(-1);
  const byName = new Array<boolean>(seatCount).fill(false);
  const used = new Set<number>();

  rows.forEach((row, i) => {
    const m = row.match;
    if (typeof m === 'number' && m >= 0 && m < seatCount && rowOfSeat[m] === -1) {
      rowOfSeat[m] = i;
      byName[m] = true;
      used.add(i);
    }
  });

  // 只有在「每一列都沒對到名字」時才整組照順序對應（例如卡上寫英文名）。
  // 有些列對到名字、有些沒有時，沒對到的列照順序填進還空著的座位。
  const freeRows = rows.map((_, i) => i).filter((i) => !used.has(i));
  for (let seat = 0; seat < seatCount && freeRows.length > 0; seat++) {
    if (rowOfSeat[seat] === -1) rowOfSeat[seat] = freeRows.shift()!;
  }
  return { rowOfSeat, byName };
}
