/**
 * Public surface of the share module.
 */

export { ShareModal } from "./ShareModal";
export type { ShareModalProps } from "./ShareModal";
export { ShareModalProvider, useShareModal } from "./ShareModalProvider";
export type { ShareModalApi, ShareModalProviderProps } from "./ShareModalProvider";
export { ShareCard } from "./ShareCard";
export type { ShareCardProps } from "./ShareCard";
export { ShareButtons } from "./ShareButtons";
export type { ShareButtonsProps } from "./ShareButtons";
export {
  SHARE_TARGETS,
  findShareTarget,
  type ShareTarget,
  type ShareTargetCtx,
  type ShareTargetId,
} from "./share-targets";
