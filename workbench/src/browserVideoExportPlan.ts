import type { ProjectData } from "./types";

export type VideoJoinErrorCode = "noVideo" | "missingFile" | "overlap" | "speed" | "invalidProject";

export class VideoJoinPlanError extends Error {
  constructor(public readonly code: VideoJoinErrorCode) {
    super(code);
    this.name = "VideoJoinPlanError";
  }
}

export interface VideoJoinClip {
  id: string;
  file: string;
  label: string;
  sourceStartSeconds: number;
  durationFrames: number;
  outputStartFrame: number;
  fit: "contain" | "cover";
  muted: boolean;
  volume: number;
  opacity: number;
  scale: number;
  x: number;
  y: number;
}

export interface VideoJoinPlan {
  fps: number;
  width: number;
  height: number;
  clips: VideoJoinClip[];
  durationFrames: number;
  ignoredLayerCount: number;
}

/**
 * Build a conservative, repeatable join plan from the Workbench timeline.
 * Visible video clips are ordered by timeline position; gaps are removed.
 * Overlaps and speed changes are rejected rather than silently mis-rendered.
 * Other visible layer types are counted for an explicit warning in the UI.
 */
export const buildVideoJoinPlan = (project: ProjectData): VideoJoinPlan => {
  if (
    !Number.isFinite(project.fps) || project.fps <= 0 ||
    !Number.isFinite(project.width) || project.width <= 0 ||
    !Number.isFinite(project.height) || project.height <= 0 ||
    !Array.isArray(project.tracks)
  ) {
    throw new VideoJoinPlanError("invalidProject");
  }

  const visibleClips = project.tracks
    .filter((track) => !track.hidden)
    .flatMap((track, trackIndex) => track.clips.map((clip) => ({ trackIndex, clip })));
  const videos = visibleClips
    .filter(({ clip }) => clip.cardId === "video-clip")
    .sort((a, b) => a.clip.start - b.clip.start || a.trackIndex - b.trackIndex);

  if (!videos.length) throw new VideoJoinPlanError("noVideo");

  const clips: VideoJoinClip[] = [];
  let outputStartFrame = 0;
  let previousEnd = -Infinity;

  for (const { clip } of videos) {
    const file = typeof clip.props.file === "string" ? clip.props.file : "";
    if (!file) throw new VideoJoinPlanError("missingFile");
    if (!Number.isFinite(clip.start) || !Number.isFinite(clip.duration) || clip.duration <= 0 || !Number.isFinite(clip.inOffset)) {
      throw new VideoJoinPlanError("invalidProject");
    }
    if (!Number.isFinite(clip.speed) || Math.abs(clip.speed - 1) > 0.0001) {
      throw new VideoJoinPlanError("speed");
    }
    if (clip.start < previousEnd) throw new VideoJoinPlanError("overlap");

    const label = clip.label?.trim() || file.split(/[\\/]/).pop() || file;
    const rawVolume = clip.props.volume;
    clips.push({
      id: clip.id,
      file,
      label,
      sourceStartSeconds: Math.max(0, clip.inOffset / project.fps),
      durationFrames: Math.round(clip.duration),
      outputStartFrame,
      fit: clip.props.fit === "cover" ? "cover" : "contain",
      muted: clip.props.muted === true || (typeof rawVolume === "number" && rawVolume <= 0),
      volume: typeof rawVolume === "number" ? Math.max(0, Math.min(1, rawVolume)) : 1,
      opacity: Math.max(0, Math.min(1, Number.isFinite(clip.opacity) ? clip.opacity : 1)),
      scale: Number.isFinite(clip.scale) && clip.scale > 0 ? clip.scale : 1,
      x: Number.isFinite(clip.x) ? clip.x : 0,
      y: Number.isFinite(clip.y) ? clip.y : 0,
    });
    outputStartFrame += Math.round(clip.duration);
    previousEnd = clip.start + clip.duration;
  }

  return {
    fps: project.fps,
    width: Math.round(project.width),
    height: Math.round(project.height),
    clips,
    durationFrames: outputStartFrame,
    ignoredLayerCount: visibleClips.filter(({ clip }) => clip.cardId !== "video-clip").length,
  };
};
