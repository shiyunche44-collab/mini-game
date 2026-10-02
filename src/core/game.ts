// 一局游戏的规则：放置、移除、旋转、提示、快照与恢复。
// 只管状态，不涉及画面、时间和平台，所以微信、抖音、网页和测试都能直接用。
//
// 坐标约定和 levels.ts 一致：物品的位置是它当前朝向外框的左上角落在第 r 行第 c 列。
import type { Item } from './items.ts';
import type { Level } from './levels.ts';

const EMPTY = -1;
const BLOCKED = -2;

/** 物品当前的状态，给画面层读。画面层不能直接改，要改走 Game 的方法 */
export interface PieceState {
  /** 在托盘里的序号，也是 level.pieces 的下标 */
  readonly id: number;
  readonly item: Item;
  /** 当前朝向，item.orients 的下标 */
  readonly oi: number;
  /** 放在箱子里的位置；在托盘里是 null */
  readonly pos: Readonly<{ r: number; c: number }> | null;
}

interface MutablePiece {
  readonly id: number;
  readonly item: Item;
  oi: number;
  pos: { r: number; c: number } | null;
}

/** 提示做了什么：摆好了哪一件，为了腾位置把哪些物品退回了托盘 */
export interface HintResult {
  readonly id: number;
  readonly kicked: readonly number[];
}

/** 存档用的快照，只含数字和数组，可以直接 JSON 序列化。每件物品是 [朝向, 行, 列]，在托盘里时行和列是 -1 */
export interface Snapshot {
  readonly n: number;
  readonly hints: number;
  readonly pieces: readonly (readonly [oi: number, r: number, c: number])[];
}

// 箱子里的物品原地旋转时，中心对不齐就依次试这几个偏移，先试不动，再试上下左右，最后试斜角
const NUDGES: readonly (readonly [number, number])[] = [
  [0, 0], [0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [-1, 1], [1, -1], [1, 1],
];

export class Game {
  readonly level: Level;
  readonly pieces: readonly PieceState[];
  private readonly list: MutablePiece[];
  // 每格是 EMPTY、BLOCKED，或者占着它的物品 id
  private readonly board: number[];
  private hints = 0;

  constructor(level: Level) {
    this.level = level;
    this.board = new Array(level.cols * level.rows).fill(EMPTY);
    for (const i of level.blocked) this.board[i] = BLOCKED;
    this.list = level.pieces.map((p, id) => ({ id, item: p.item, oi: p.startOi, pos: null }));
    this.pieces = this.list;
  }

  /** 已经用了几次提示 */
  get hintsUsed(): number {
    return this.hints;
  }

  /** 还在托盘里的物品有几件 */
  get remaining(): number {
    return this.list.filter((p) => !p.pos).length;
  }

  /** 全部放进箱子就算过关：关卡保证物品总格数正好等于可用格数，放得下就是铺满 */
  isComplete(): boolean {
    return this.list.every((p) => p.pos);
  }

  /** 这一格是不是箱子里的拉杆槽。箱子外面不算 */
  isBlocked(r: number, c: number): boolean {
    return this.inside(r, c) && this.cell(r, c) === BLOCKED;
  }

  /** 这一格被哪件物品占着，返回物品 id；空格、拉杆槽、箱子外面都返回 null */
  pieceAt(r: number, c: number): number | null {
    const v = this.cell(r, c);
    return v >= 0 ? v : null;
  }

  /** 第 id 件物品用第 oi 个朝向放在 (r, c) 能不能放下。它自己现在占着的格子算空的 */
  canPlace(id: number, oi: number, r: number, c: number): boolean {
    const p = this.piece(id);
    const o = p.item.orients[oi];
    if (!o || !Number.isInteger(r) || !Number.isInteger(c)) return false;
    return o.cells.every(([dr, dc]) => {
      const v = this.cell(r + dr, c + dc);
      return v === EMPTY || v === id;
    });
  }

  /**
   * 把物品放进箱子，已经在箱子里的就是挪位置。放不下返回 false，状态不变。
   * 不能旋转的关卡里，朝向只能是物品现在的朝向。
   */
  place(id: number, r: number, c: number, oi?: number): boolean {
    const p = this.piece(id);
    const to = oi ?? p.oi;
    if (!this.level.rotate && to !== p.oi) return false;
    if (!this.canPlace(id, to, r, c)) return false;
    this.take(p);
    p.oi = to;
    p.pos = { r, c };
    this.mark(p, id);
    return true;
  }

  /** 把物品从箱子里拿回托盘，朝向不变。本来就在托盘里则什么也不做 */
  remove(id: number): void {
    this.take(this.piece(id));
  }

  /**
   * 顺时针转 90°，托盘里和箱子里的都能转。返回有没有转动。
   * 箱子里的物品尽量让中心不动，转不开就不转，状态不变。
   */
  rotate(id: number): boolean {
    const p = this.piece(id);
    const n = p.item.orients.length;
    if (!this.level.rotate || n < 2) return false;
    const next = (p.oi + 1) % n;
    if (!p.pos) {
      p.oi = next;
      return true;
    }
    const cur = p.item.orients[p.oi];
    const nxt = p.item.orients[next];
    if (!cur || !nxt) return false;
    const r0 = Math.round(p.pos.r + cur.h / 2 - nxt.h / 2);
    const c0 = Math.round(p.pos.c + cur.w / 2 - nxt.w / 2);
    return NUDGES.some(([dr, dc]) => this.place(id, r0 + dr, c0 + dc, next));
  }

  /**
   * 重来：物品全部回到托盘。朝向保持现状，提示次数也不清零（提示是看广告换来的，重来不该白白丢掉）。
   */
  reset(): void {
    for (const p of this.list) this.take(p);
  }

  /**
   * 提示：按答案摆好一件物品，挡路的物品退回托盘。已经摆对的不会被挪走，已经全部摆对返回 null。
   *
   * 形状相同的物品可以互换：运动鞋、防晒霜、帽子都是 1×2，谁摆在哪个位置都算对。
   * 所以先看哪些答案位置已经有形状合适的物品占着，再从剩下的位置里挑最大的一个来摆。
   * 每次提示至少多摆对一件，所以最多点（物品数）次一定通关。
   */
  hint(): HintResult | null {
    const slots = this.level.pieces.map((lp, i) => {
      const o = lp.item.orients[lp.solution.oi];
      return { i, ...lp.solution, key: o ? o.key : '', size: lp.item.size };
    });

    // 已经摆对的物品，和还没摆对的答案位置
    const settled = new Set<number>();
    const open: typeof slots = [];
    for (const s of slots) {
      // 两个答案位置不会起点和形状都相同（那样就重叠了），所以一件物品不会被两个位置同时认领
      const q = this.list.find((q) => q.pos?.r === s.r && q.pos.c === s.c && this.shapeOf(q).key === s.key);
      if (q) settled.add(q.id);
      else open.push(s);
    }

    // 先摆大的：大件最挑位置，晚摆容易被小件挡住
    open.sort((a, b) => b.size - a.size || a.i - b.i);
    const s = open[0];
    if (!s) return null;

    // 能摆到这个位置的物品：形状对得上，不能旋转的关卡里还得是现在的朝向。优先用托盘里的，少打乱已经摆好的
    const canTake = (q: MutablePiece): boolean =>
      this.level.rotate ? q.item.orients.some((o) => o.key === s.key) : this.shapeOf(q).key === s.key;
    const p = this.list
      .filter((q) => !settled.has(q.id) && canTake(q))
      .sort((a, b) => (a.pos ? 1 : 0) - (b.pos ? 1 : 0) || a.id - b.id)[0];
    const oi = p?.item.orients.findIndex((o) => o.key === s.key) ?? -1;
    // 物品和答案位置一一对应，形状相同的物品数量一样，所以这里一定找得到。找不到说明数据坏了，不能悄悄放过
    if (!p || oi < 0) throw new Error(`提示找不到能摆到第 ${s.r} 行第 ${s.c} 列的物品`);

    this.take(p);
    const kicked: number[] = [];
    for (const [dr, dc] of p.item.orients[oi]?.cells ?? []) {
      const q = this.pieceAt(s.r + dr, s.c + dc);
      if (q !== null) {
        this.take(this.piece(q));
        kicked.push(q);
      }
    }
    // 答案位置只被答案里的这一件占着，不会碰到拉杆槽，也不会碰到已经摆对的物品，所以挪开挡路的以后一定放得下
    if (!this.place(p.id, s.r, s.c, oi)) throw new Error(`提示没能把第 ${p.id} 件摆到答案位置`);
    this.hints++;
    return { id: p.id, kicked };
  }

  snapshot(): Snapshot {
    return {
      n: this.level.n,
      hints: this.hints,
      pieces: this.list.map((p): [number, number, number] => [p.oi, p.pos ? p.pos.r : -1, p.pos ? p.pos.c : -1]),
    };
  }

  /**
   * 恢复快照。存档来自外面（可能是旧版本、损坏、被改过），所以每一项都检查：
   * 要么整份都合法、全部恢复，要么返回 false 并且一点都不改。
   */
  restore(data: unknown): boolean {
    const snap = data as Partial<Snapshot> | null;
    if (typeof snap !== 'object' || snap === null) return false;
    const { n, hints, pieces } = snap;
    if (n !== this.level.n || !Number.isSafeInteger(hints) || (hints as number) < 0) return false;
    if (!Array.isArray(pieces) || pieces.length !== this.list.length) return false;

    // 在一块新板子上试摆一遍，全部通过才动真的状态
    const board = new Array<number>(this.board.length).fill(EMPTY);
    for (const i of this.level.blocked) board[i] = BLOCKED;
    const next: { oi: number; pos: { r: number; c: number } | null }[] = [];
    for (let id = 0; id < pieces.length; id++) {
      const entry: unknown = pieces[id];
      const p = this.list[id] as MutablePiece;
      if (!Array.isArray(entry) || entry.length !== 3 || !entry.every(Number.isSafeInteger)) return false;
      const [oi, r, c] = entry as [number, number, number];
      const o = p.item.orients[oi];
      if (!o) return false;
      // 不能旋转的关卡里朝向是固定的，存档里写了别的朝向就是坏数据
      if (!this.level.rotate && oi !== this.level.pieces[id]?.startOi) return false;
      if (r === -1 && c === -1) {
        next.push({ oi, pos: null });
        continue;
      }
      for (const [dr, dc] of o.cells) {
        const rr = r + dr;
        const cc = c + dc;
        if (rr < 0 || rr >= this.level.rows || cc < 0 || cc >= this.level.cols) return false;
        if (board[rr * this.level.cols + cc] !== EMPTY) return false;
        board[rr * this.level.cols + cc] = id;
      }
      next.push({ oi, pos: { r, c } });
    }

    this.list.forEach((p, id) => {
      const s = next[id] as (typeof next)[number];
      p.oi = s.oi;
      p.pos = s.pos;
    });
    this.board.splice(0, this.board.length, ...board);
    this.hints = hints as number;
    return true;
  }

  // ---------------------------------------------------------------------------

  private piece(id: number): MutablePiece {
    const p = this.list[id];
    if (!p) throw new RangeError(`没有第 ${id} 件物品，一共 ${this.list.length} 件`);
    return p;
  }

  private shapeOf(p: MutablePiece) {
    return p.item.orients[p.oi] as Item['orients'][number];
  }

  private inside(r: number, c: number): boolean {
    return Number.isInteger(r) && Number.isInteger(c) && r >= 0 && r < this.level.rows && c >= 0 && c < this.level.cols;
  }

  /** 这一格的内容。箱子外面按拉杆槽算：放不进去，也不是任何物品 */
  private cell(r: number, c: number): number {
    return this.inside(r, c) ? (this.board[r * this.level.cols + c] as number) : BLOCKED;
  }

  private mark(p: MutablePiece, v: number): void {
    if (!p.pos) return;
    for (const [dr, dc] of this.shapeOf(p).cells) this.board[(p.pos.r + dr) * this.level.cols + p.pos.c + dc] = v;
  }

  /** 从箱子里拿起来：释放占着的格子，位置清空 */
  private take(p: MutablePiece): void {
    this.mark(p, EMPTY);
    p.pos = null;
  }
}
