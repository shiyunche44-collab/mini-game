const EMPTY = -1;
const BLOCKED = -2;

// 一局游戏的状态和规则，不涉及任何画面，微信 / 抖音 / 网页都能直接用
export class Game {
  constructor(level) {
    this.level = level;
    this.cols = level.cols;
    this.rows = level.rows;
    this.board = new Array(level.cols * level.rows).fill(EMPTY);
    for (const i of level.blocked) this.board[i] = BLOCKED;
    this.pieces = level.pieces.map((p, id) => ({
      id,
      item: p.item,
      oi: p.startOi,
      pos: null,
      solution: p.solution,
    }));
    this.hintsUsed = 0;
  }

  shape(p, oi = p.oi) {
    return p.item.orients[oi];
  }

  inside(r, c) {
    return r >= 0 && r < this.rows && c >= 0 && c < this.cols;
  }

  isBlocked(r, c) {
    return this.inside(r, c) && this.board[r * this.cols + c] === BLOCKED;
  }

  pieceAt(r, c) {
    if (!this.inside(r, c)) return null;
    const v = this.board[r * this.cols + c];
    return v >= 0 ? this.pieces[v] : null;
  }

  canPlace(p, oi, r0, c0) {
    return this.shape(p, oi).cells.every(([r, c]) => {
      const rr = r0 + r;
      const cc = c0 + c;
      if (!this.inside(rr, cc)) return false;
      const v = this.board[rr * this.cols + cc];
      return v === EMPTY || v === p.id;
    });
  }

  place(p, r0, c0, oi = p.oi) {
    if (!this.canPlace(p, oi, r0, c0)) return false;
    this.remove(p);
    p.oi = oi;
    p.pos = { r: r0, c: c0 };
    for (const [r, c] of this.shape(p).cells) this.board[(r0 + r) * this.cols + c0 + c] = p.id;
    return true;
  }

  remove(p) {
    if (!p.pos) return;
    for (const [r, c] of this.shape(p).cells) this.board[(p.pos.r + r) * this.cols + p.pos.c + c] = EMPTY;
    p.pos = null;
  }

  rotateInTray(p) {
    p.oi = (p.oi + 1) % p.item.orients.length;
  }

  // 箱子里的物品原地旋转：尽量保持中心不动，转不开就返回 false
  rotatePlaced(p) {
    const next = (p.oi + 1) % p.item.orients.length;
    const cur = this.shape(p);
    const nx = this.shape(p, next);
    const br = Math.round(p.pos.r + cur.h / 2 - nx.h / 2);
    const bc = Math.round(p.pos.c + cur.w / 2 - nx.w / 2);
    const tries = [[0, 0], [0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [-1, 1], [1, -1], [1, 1]];
    return tries.some(([dr, dc]) => this.place(p, br + dr, bc + dc, next));
  }

  get remaining() {
    return this.pieces.filter((p) => !p.pos).length;
  }

  isComplete() {
    return this.pieces.every((p) => p.pos);
  }

  reset() {
    for (const p of this.pieces) this.remove(p);
  }

  // 提示：按答案摆好一件物品，挡路的物品退回托盘。
  // 形状相同的物品可以互换，已经放对位置的不会被挪走。
  hint() {
    const slots = this.pieces.map((p) => ({ ...p.solution, key: p.item.orients[p.solution.oi].key, size: p.item.size }));
    const settled = new Set();
    const open = [];
    for (const s of slots) {
      const q = this.pieces.find(
        (q) => !settled.has(q) && q.pos && q.pos.r === s.r && q.pos.c === s.c && this.shape(q).key === s.key,
      );
      if (q) settled.add(q);
      else open.push(s);
    }
    if (!open.length) return null;
    open.sort((a, b) => b.size - a.size);
    const s = open[0];
    const p = this.pieces
      .filter((q) => !settled.has(q) && q.item.orients.some((o) => o.key === s.key))
      .sort((a, b) => (a.pos ? 1 : 0) - (b.pos ? 1 : 0))[0];
    const oi = p.item.orients.findIndex((o) => o.key === s.key);
    const kicked = [];
    this.remove(p);
    for (const [r, c] of p.item.orients[oi].cells) {
      const q = this.pieceAt(s.r + r, s.c + c);
      if (q) {
        this.remove(q);
        kicked.push(q);
      }
    }
    this.place(p, s.r, s.c, oi);
    this.hintsUsed++;
    return { piece: p, kicked };
  }

  snapshot() {
    return this.pieces.map((p) => [p.oi, p.pos ? p.pos.r : -1, p.pos ? p.pos.c : -1]);
  }

  restore(data) {
    if (!Array.isArray(data) || data.length !== this.pieces.length) return;
    this.pieces.forEach((p, i) => {
      const [oi, r, c] = data[i];
      if (!(oi >= 0 && oi < p.item.orients.length)) return;
      p.oi = oi;
      if (r >= 0) this.place(p, r, c);
    });
  }
}
