import {
  AudioBufferSource,
  BlobSource,
  BufferTarget,
  CanvasSource,
  canEncodeAudio,
  Input,
  ALL_FORMATS,
  Mp4OutputFormat,
  Output,
  Quality,
} from "mediabunny";
import { getLocalVideoBlob, isLocalVideoRef, localVideoId } from "./localMedia";
import { publicAssetUrl } from "./publicAssetUrl";
import type { VideoJoinPlan, VideoJoinClip } from "./browserVideoExportPlan";

export type VideoJoinProgress = (phase: "loading" | "encoding" | "finalizing", ratio: number) => void;

const getVideoBlob = async (file: string): Promise<Blob> => {
  if (isLocalVideoRef(file)) {
    const blob = await getLocalVideoBlob(localVideoId(file));
    if (!blob) throw new Error(`Missing local video: ${file}`);
    return blob;
  }
  const response = await fetch(publicAssetUrl(file));
  if (!response.ok) throw new Error(`Could not read video asset (${response.status}): ${file}`);
  return response.blob();
};

const loadVideo = (url: string): Promise<HTMLVideoElement> => new Promise((resolve, reject) => {
  const video = document.createElement("video");
  video.preload = "auto";
  video.muted = true;
  video.playsInline = true;
  const cleanup = () => {
    video.removeEventListener("loadeddata", loaded);
    video.removeEventListener("error", failed);
  };
  const loaded = () => {
    cleanup();
    resolve(video);
  };
  const failed = () => {
    cleanup();
    reject(new Error("This browser could not decode one of the video clips."));
  };
  video.addEventListener("loadeddata", loaded, { once: true });
  video.addEventListener("error", failed, { once: true });
  video.src = url;
  video.load();
});

const seekVideo = (video: HTMLVideoElement, time: number): Promise<void> => {
  const target = Math.max(0, Math.min(time, Math.max(0, video.duration - 0.001)));
  if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && Math.abs(video.currentTime - target) < 0.002) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => finish(new Error("Timed out while seeking a video frame.")), 15000);
    const cleanup = () => {
      window.clearTimeout(timer);
      video.removeEventListener("seeked", seeked);
      video.removeEventListener("error", failed);
    };
    const finish = (error?: Error) => {
      cleanup();
      if (error) reject(error);
      else resolve();
    };
    const seeked = () => finish();
    const failed = () => finish(new Error("Could not decode a frame from one of the video clips."));
    video.addEventListener("seeked", seeked, { once: true });
    video.addEventListener("error", failed, { once: true });
    try {
      video.currentTime = target;
    } catch (error) {
      finish(error instanceof Error ? error : new Error(String(error)));
    }
  });
};

const drawFrame = (
  context: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  clip: VideoJoinClip,
  width: number,
  height: number,
) => {
  context.fillStyle = "#000";
  context.fillRect(0, 0, width, height);
  const scale = clip.fit === "cover"
    ? Math.max(width / video.videoWidth, height / video.videoHeight)
    : Math.min(width / video.videoWidth, height / video.videoHeight);
  const drawWidth = video.videoWidth * scale;
  const drawHeight = video.videoHeight * scale;
  context.save();
  context.globalAlpha = clip.opacity;
  context.translate(width / 2 + clip.x, height / 2 + clip.y);
  context.scale(clip.scale, clip.scale);
  context.drawImage(video, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
  context.restore();
};

const loadAudioBuffer = async (blob: Blob, audioContext: AudioContext): Promise<AudioBuffer | null> => {
  // Parse tracks first: a video-only file is expected and should not be treated as a decode failure.
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track) return null;
  } finally {
    input.dispose();
  }
  return audioContext.decodeAudioData(await blob.arrayBuffer());
};

const addAudioChunk = async (
  source: AudioBufferSource,
  context: AudioContext,
  audio: AudioBuffer | null,
  clip: VideoJoinClip,
  outputSampleStart: number,
  sampleCount: number,
) => {
  const chunk = context.createBuffer(2, sampleCount, context.sampleRate);
  if (audio && !clip.muted && clip.volume > 0) {
    const sourceStart = Math.max(0, Math.round(clip.sourceStartSeconds * audio.sampleRate));
    const left = audio.getChannelData(0);
    const right = audio.numberOfChannels > 1 ? audio.getChannelData(1) : left;
    const outLeft = chunk.getChannelData(0);
    const outRight = chunk.getChannelData(1);
    for (let i = 0; i < sampleCount; i++) {
      const sourceIndex = sourceStart + Math.round(outputSampleStart) + i;
      if (sourceIndex >= audio.length) break;
      outLeft[i] = left[sourceIndex] * clip.volume;
      outRight[i] = right[sourceIndex] * clip.volume;
    }
  }
  await source.add(chunk);
}

export const renderVideoJoin = async (
  plan: VideoJoinPlan,
  onProgress: VideoJoinProgress = () => {},
): Promise<{ blob: Blob; audioWarnings: number }> => {
  if (typeof VideoEncoder === "undefined") {
    throw new Error("This browser does not support WebCodecs video encoding. Try a current version of Chrome, Edge, or Safari.");
  }
  if (typeof AudioContext === "undefined") {
    throw new Error("This browser does not support Web Audio video processing.");
  }

  if (!(await canEncodeAudio("aac", { numberOfChannels: 2, sampleRate: 48000 }))) {
    const { registerAacEncoder } = await import("@mediabunny/aac-encoder");
    registerAacEncoder();
  }

  const audioContext = new AudioContext({ sampleRate: 48000 });
  await audioContext.resume();
  const canvas = document.createElement("canvas");
  canvas.width = plan.width;
  canvas.height = plan.height;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) {
    await audioContext.close();
    throw new Error("Could not create a browser canvas for video export.");
  }

  const target = new BufferTarget();
  const output = new Output({ format: new Mp4OutputFormat(), target });
  const videoSource = new CanvasSource(canvas, {
    codec: "avc",
    quality: new Quality("medium"),
  });
  const audioSource = new AudioBufferSource({
    codec: "aac",
    quality: new Quality({ bitrate: 128_000 }),
  });
  output.addVideoTrack(videoSource, { frameRate: plan.fps });
  output.addAudioTrack(audioSource);

  let audioWarnings = 0;
  const totalFrames = plan.durationFrames;
  const totalSamples = Math.round((totalFrames / plan.fps) * audioContext.sampleRate);
  let outputSampleStart = 0;
  const framesPerChunk = Math.max(1, Math.round(plan.fps));
  let processedFrames = 0;
  let activeVideo: HTMLVideoElement | null = null;
  let activeUrl: string | null = null;

  try {
    await output.start();
    for (const clip of plan.clips) {
      onProgress("loading", processedFrames / totalFrames);
      const blob = await getVideoBlob(clip.file);
      activeUrl = URL.createObjectURL(blob);
      activeVideo = await loadVideo(activeUrl);
      const sourceDuration = clip.durationFrames / plan.fps;
      if (clip.sourceStartSeconds + sourceDuration > activeVideo.duration + 1 / plan.fps) {
        throw new Error(`The timeline trim for “${clip.label}” exceeds the source video length.`);
      }

      let audio: AudioBuffer | null = null;
      try {
        audio = await loadAudioBuffer(blob, audioContext);
      } catch {
        audioWarnings++;
      }

      for (let segmentStart = 0; segmentStart < clip.durationFrames; segmentStart += framesPerChunk) {
        const segmentFrames = Math.min(framesPerChunk, clip.durationFrames - segmentStart);
        const segmentSamples = Math.min(
          totalSamples - outputSampleStart,
          Math.round((segmentFrames / plan.fps) * audioContext.sampleRate),
        );
        if (segmentSamples > 0) {
          await addAudioChunk(audioSource, audioContext, audio, clip, segmentStart / plan.fps * audioContext.sampleRate, segmentSamples);
          outputSampleStart += segmentSamples;
        }

        for (let frameInClip = segmentStart; frameInClip < segmentStart + segmentFrames; frameInClip++) {
          const sourceTime = clip.sourceStartSeconds + frameInClip / plan.fps;
          await seekVideo(activeVideo, sourceTime);
          drawFrame(context, activeVideo, clip, canvas.width, canvas.height);
          const outputFrame = clip.outputStartFrame + frameInClip;
          await videoSource.add(outputFrame / plan.fps, 1 / plan.fps);
          processedFrames++;
          onProgress("encoding", processedFrames / totalFrames);
        }
      }

      activeVideo.pause();
      activeVideo.removeAttribute("src");
      activeVideo.load();
      activeVideo = null;
      URL.revokeObjectURL(activeUrl);
      activeUrl = null;
    }

    // Fill any sub-sample rounding remainder to keep the audio track aligned with the video.
    if (outputSampleStart < totalSamples) {
      await addAudioChunk(audioSource, audioContext, null, plan.clips[plan.clips.length - 1], 0, totalSamples - outputSampleStart);
    }
    audioSource.close();
    videoSource.close();
    onProgress("finalizing", 0.98);
    await output.finalize();
    const buffer = target.buffer;
    if (!buffer) throw new Error("The browser finished rendering but did not return an MP4 file.");
    onProgress("finalizing", 1);
    return { blob: new Blob([buffer], { type: "video/mp4" }), audioWarnings };
  } finally {
    if (activeVideo) {
      activeVideo.pause();
      activeVideo.removeAttribute("src");
      activeVideo.load();
    }
    if (activeUrl) URL.revokeObjectURL(activeUrl);
    await audioContext.close().catch(() => {});
  }
};
