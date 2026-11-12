import type { ProjectData } from "./types";

export type BrowserRenderErrorCode = "noVisual" | "missingFile" | "invalidProject";

export class BrowserRenderPlanError extends Error {
  constructor(public readonly code: BrowserRenderErrorCode) {
    super(code);
    this.name = "BrowserRenderPlanError";
  }
}

export const BROWSER_RENDER_CARD_IDS = new Set([
  "video-clip",
  "image-clip",
  "audio-clip",
  "text-basic",
  "inkpress-title-card",
  "inkpress-caption",
  "inkpress-flash-cut",
  "bg-paper",
  "bg-paper-glow",
  "bg-white",
  "bg-ink",
]);

export interface BrowserRenderClip {
  id: string;
  cardId: string;
  label: string;
  start: number;
  duration: number;
  inOffset: number;
  speed: number;
  opacity: number;
  scale: number;
  x: number;
  y: number;
  props: Record<string, unknown>;
  /** Original track index; track 0 is the topmost layer. */
  trackIndex: number;
}

export interface BrowserRenderPlan {
  fps: number;
  width: number;
  height: number;
  background: string;
  themeId?: string;
  themeColors?: Record<string, string>;
  durationFrames: number;
  visualClips: BrowserRenderClip[];
  audioClips: BrowserRenderClip[];
  unsupportedLayers: Array<{ id: string; cardId: string; label: string }>;
}

/**
 * Build a deterministic browser-render plan from the visible timeline. Unlike the
 * old join-only plan, this preserves timeline time (including gaps), track order,
 * overlaps, clip speed, trims, visual layers and separate audio layers.
 * Unsupported demo cards are reported explicitly so the UI can block a lossy export.
 */
export const buildBrowserRenderPlan = (project: ProjectData): BrowserRenderPlan => {
  if (
    !Number.isFinite(project.fps) || project.fps < 1 || project.fps > 120 ||
    !Number.isFinite(project.width) || project.width < 1 || project.width > 8192 ||
    !Number.isFinite(project.height) || project.height < 1 || project.height > 8192 ||
    !Array.isArray(project.tracks) ||
    (project.tracks as unknown[]).some((track) => !track || !Array.isArray((track as { clips?: unknown }).clips))
  ) {
    throw new BrowserRenderPlanError("invalidProject");
  }

  const visualClips: BrowserRenderClip[] = [];
  const audioClips: BrowserRenderClip[] = [];
  const unsupportedLayers: BrowserRenderPlan["unsupportedLayers"] = [];
  let durationFrames = 0;

  // Composition.tsx renders track 0 last (topmost). Reverse tracks here so the
  // Canvas renderer paints bottom-to-top, retaining within-track clip order.
  for (const trackIndex of project.tracks.map((_, i) => i).reverse()) {
    const track = project.tracks[trackIndex];
    if (track.hidden) continue;
    for (const clip of track.clips) {
      if (
        !Number.isFinite(clip.start) || clip.start < 0 ||
        !Number.isFinite(clip.duration) || clip.duration <= 0 ||
        !Number.isFinite(clip.inOffset) || clip.inOffset < 0 ||
        !Number.isFinite(clip.speed) || clip.speed <= 0 || clip.speed > 16 ||
        !Number.isFinite(clip.opacity) || !Number.isFinite(clip.scale) ||
        !Number.isFinite(clip.x) || !Number.isFinite(clip.y)
      ) {
        throw new BrowserRenderPlanError("invalidProject");
      }
      const end = Math.round(clip.start + clip.duration);
      durationFrames = Math.max(durationFrames, end);
      const label = clip.label?.trim() || clip.cardId;
      if (!BROWSER_RENDER_CARD_IDS.has(clip.cardId)) {
        unsupportedLayers.push({ id: clip.id, cardId: clip.cardId, label });
        continue;
      }
      const renderClip: BrowserRenderClip = {
        id: clip.id,
        cardId: clip.cardId,
        label,
        start: Math.round(clip.start),
        duration: Math.max(1, Math.round(clip.duration)),
        inOffset: clip.inOffset,
        speed: clip.speed,
        opacity: Math.max(0, Math.min(1, clip.opacity)),
        scale: clip.scale > 0 ? clip.scale : 1,
        x: clip.x,
        y: clip.y,
        props: clip.props ?? {},
        trackIndex,
      };
      if (["video-clip", "image-clip", "audio-clip"].includes(clip.cardId)) {
        if (typeof renderClip.props.file !== "string" || !renderClip.props.file.trim()) {
          throw new BrowserRenderPlanError("missingFile");
        }
      }
      if (clip.cardId === "audio-clip") audioClips.push(renderClip);
      else visualClips.push(renderClip);
    }
  }

  if (!visualClips.length) throw new BrowserRenderPlanError("noVisual");
  return {
    fps: project.fps,
    width: Math.round(project.width),
    height: Math.round(project.height),
    background: project.background ?? "#0e0e10",
    themeId: project.themeId,
    themeColors: project.themeColors,
    durationFrames,
    visualClips,
    audioClips,
    unsupportedLayers,
  };
};
