// 物品图标：启动时把产物里有的图标都读进来（ADR 0006）。读完之前、读失败的物品继续画 emoji，
// 所以图可以一张一张地补，也不会因为某张图坏了影响游戏。
import type { ImageSource, Platform } from '../platform/types.ts';

/** 产物里图标的位置，文件名是物品 id（art-spec.md） */
export const ICON_DIR = 'assets/icons';
export const iconPath = (id: string): string => `${ICON_DIR}/${id}.png`;

/** 画物品时用的图标来源：没有这件物品的图标就返回 null，调用方退回 emoji */
export interface ItemIcons {
  get(id: string): ImageSource | null;
}

export class Icons implements ItemIcons {
  private readonly images = new Map<string, ImageSource>();

  /** ids 是产物里有图的物品 id（构建时扫描 assets/icons 得到），没有的不会发请求 */
  constructor(platform: Pick<Platform, 'loadImage'>, ids: readonly string[]) {
    for (const id of ids) {
      platform
        .loadImage(iconPath(id))
        .then((img) => {
          if (img) this.images.set(id, img);
        })
        // loadImage 约定不抛异常；万一实现违约，当作这张图没读到
        .catch(() => undefined);
    }
  }

  get(id: string): ImageSource | null {
    return this.images.get(id) ?? null;
  }
}
