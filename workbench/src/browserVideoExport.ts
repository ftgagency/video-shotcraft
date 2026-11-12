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
import { getLocalMediaBlob, isLocalMediaRef, localMediaId } from "./localMedia";
import { publicAssetUrl } from "./publicAssetUrl";
import { CARDS } from "./cards/registry";
import { MANIFEST } from "./cards/projectCards";
import { themedBackground, themedProps } from "./theme";
import type { ProjectData } from "./types";
import type { BrowserRenderClip, BrowserRenderPlan } from "./browserVideoExportPlan";

export type BrowserRenderProgress = (phase: "loading" | "encoding" | "finalizing", ratio: number) => void;

type VideoResource = { element: HTMLVideoElement; url: string };
type DecodedAudio = { buffer: AudioBuffer | null; failed: boolean };
const numberProp = (props: Record<string, unknown>, key: string, fallback: number) =>
  typeof props[key] === "number" && Number.isFinite(props[key]) ? props[key] as number : fallback;
const stringProp = (props: Record<string, unknown>, key: string, fallback: string) =>
  typeof props[key] === "string" ? props[key] as string : fallback;
const boolProp = (props: Record<string, unknown>, key: string, fallback: boolean) =>
  typeof props[key] === "boolean" ? props[key] as boolean : fallback;
const clamp = (value: number, low = 0, high = 1) => Math.max(low, Math.min(high, value));
const smoothOut = (value: number, power: number) => 1 - Math.pow(1 - clamp(value), power);
const tween = (seconds: number, delay: number, duration: number, ease: (x: number) => number = (x) => x) =>
  ease(clamp((seconds - delay) / Math.max(0.001, duration)));

const fetchMediaBlob = async (file: string): Promise<Blob> => {
  if (isLocalMediaRef(file)) {
    const blob = await getLocalMediaBlob(localMediaId(file));
    if (!blob) throw new Error(`Missing local media: ${file}`);
    return blob;
  }
  const response = await fetch(publicAssetUrl(file));
  if (!response.ok) throw new Error(`Could not read media asset (${response.status}): ${file}`);
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
  const loaded = () => { cleanup(); resolve(video); };
  const failed = () => { cleanup(); reject(new Error("This browser could not decode one of the video clips.")); };
  video.addEventListener("loadeddata", loaded, { once: true });
  video.addEventListener("error", failed, { once: true });
  video.src = url;
  video.load();
});

const loadImage = (url: string): Promise<HTMLImageElement> => new Promise((resolve, reject) => {
  const image = new Image();
  image.onload = () => resolve(image);
  image.onerror = () => reject(new Error("This browser could not decode one of the image assets."));
  image.src = url;
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
    try { video.currentTime = target; }
    catch (error) { finish(error instanceof Error ? error : new Error(String(error))); }
  });
};

const fitRect = (sourceWidth: number, sourceHeight: number, width: number, height: number, fit: string) => {
  const scale = fit === "cover"
    ? Math.max(width / sourceWidth, height / sourceHeight)
    : Math.min(width / sourceWidth, height / sourceHeight);
  const drawWidth = sourceWidth * scale;
  const drawHeight = sourceHeight * scale;
  return { x: (width - drawWidth) / 2, y: (height - drawHeight) / 2, width: drawWidth, height: drawHeight };
};

const wrapLines = (context: CanvasRenderingContext2D, text: string, maxWidth: number) => {
  const result: string[] = [];
  for (const paragraph of text.split("\n")) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (!words.length) { result.push(""); continue; }
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (line && context.measureText(candidate).width > maxWidth) {
        result.push(line);
        line = word;
      } else line = candidate;
    }
    result.push(line);
  }
  return result;
};

const drawTextBasic = (context: CanvasRenderingContext2D, clip: BrowserRenderClip, frame: number, plan: BrowserRenderPlan) => {
  const p = clip.props;
  const content = stringProp(p, "content", "Type your text here");
  const fontSize = numberProp(p, "fontSize", 64);
  const color = stringProp(p, "color", "#1d1d1f");
  const bg = stringProp(p, "bg", "#ffffff");
  const transparentBg = boolProp(p, "transparentBg", false);
  const fontWeight = stringProp(p, "fontWeight", "700");
  const letterSpacing = numberProp(p, "letterSpacing", 0);
  const align = stringProp(p, "align", "center");
  const anim = stringProp(p, "anim", "fade-up");
  const sourceFrame = clip.inOffset + (frame - clip.start) * clip.speed;
  const seconds = sourceFrame / 30;
  const delay = numberProp(p, "delay", 0.3);
  const animDur = numberProp(p, "animDur", 0.4);
  let opacity = 1;
  let shiftY = 0;
  let scale = 1;
  let mask = 1;
  if (anim === "fade-up") {
    const progress = tween(seconds, delay, animDur, (x) => smoothOut(x, 3));
    opacity = progress;
    shiftY = (1 - progress) * 24;
  } else if (anim === "slam") {
    const progress = tween(seconds, delay, animDur, (x) => smoothOut(x, 4));
    opacity = progress;
    scale = 1.12 - 0.12 * progress;
  } else if (anim === "mask") {
    mask = tween(seconds, delay, animDur, (x) => smoothOut(x, 3));
  } else if (anim === "typewriter") {
    mask = tween(seconds, delay, animDur);
  } else if (anim === "fade") {
    opacity = tween(seconds, delay, animDur, (x) => smoothOut(x, 2));
  }

  if (!transparentBg) {
    context.fillStyle = bg;
    context.fillRect(0, 0, plan.width, plan.height);
  }
  context.save();
  context.globalAlpha *= opacity;
  context.translate(plan.width / 2, plan.height / 2 + shiftY);
  context.scale(scale, scale);
  context.translate(-plan.width / 2, -plan.height / 2);
  context.font = `${fontWeight} ${fontSize}px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
  context.fillStyle = color;
  context.textBaseline = "middle";
  context.textAlign = align as CanvasTextAlign;
  if ("letterSpacing" in context) (context as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${letterSpacing}px`;
  const lines = wrapLines(context, content, Math.max(1, plan.width - 144));
  const lineHeight = fontSize * 1.3;
  const blockHeight = lines.length * lineHeight;
  const firstY = (plan.height - blockHeight) / 2 + lineHeight / 2;
  const x = align === "left" ? 72 : align === "right" ? plan.width - 72 : plan.width / 2;
  const typeCount = anim === "typewriter" ? Math.floor(mask * content.length) : content.length;
  const visibleContent = content.slice(0, typeCount);
  const visibleLines = anim === "typewriter" ? visibleContent.split("\n") : lines;
  const maxTextWidth = Math.max(1, ...lines.map((line) => context.measureText(line).width));
  if (anim === "mask") {
    context.beginPath();
    context.rect(0, 0, Math.max(0, plan.width * mask), plan.height);
    context.clip();
  }
  visibleLines.forEach((line, index) => context.fillText(line, x, firstY + index * lineHeight, Math.max(plan.width * 2, maxTextWidth)));
  context.restore();
};

const parseTitleWords = (text: string) => text.split(/\s+/).filter(Boolean).map((word) => {
  const match = word.match(/^\*(.+)\*$/);
  return match ? { text: match[1], accent: true } : { text: word, accent: false };
});

const drawTitleCard = (context: CanvasRenderingContext2D, clip: BrowserRenderClip, frame: number, plan: BrowserRenderPlan) => {
  const p = clip.props;
  const sourceFrame = clip.inOffset + (frame - clip.start) * clip.speed;
  const duration = numberProp(p, "duration", clip.inOffset + clip.duration * clip.speed);
  const text = stringProp(p, "text", "All your team’s research, *one* place to go.");
  const bg = stringProp(p, "bg", "#f7f4ee");
  const ink = stringProp(p, "ink", "#1c1a17");
  const accent = stringProp(p, "accent", "#b5651d");
  const fontSize = numberProp(p, "fontSize", 116);
  const underlineWidth = numberProp(p, "underlineWidth", 220);
  const fadeOut = clamp((duration - sourceFrame) / 8);
  context.save();
  context.globalAlpha *= fadeOut;
  context.fillStyle = bg;
  context.fillRect(0, 0, plan.width, plan.height);
  const glow = context.createRadialGradient(plan.width * 0.5, plan.height * 0.42, 0, plan.width * 0.5, plan.height * 0.42, Math.max(plan.width, plan.height) * 0.75);
  glow.addColorStop(0, "rgba(255,252,244,0.85)");
  glow.addColorStop(0.65, "rgba(255,252,244,0.85)");
  glow.addColorStop(1, "rgba(255,252,244,0)");
  context.fillStyle = glow;
  context.fillRect(0, 0, plan.width, plan.height);

  const words = parseTitleWords(text);
  const font = `600 ${fontSize}px Georgia, "Times New Roman", serif`;
  context.font = font;
  const gap = fontSize * 0.26;
  const maxWidth = Math.min(1500, plan.width - 120);
  const lines: Array<Array<{ text: string; accent: boolean; width: number; progress: number }>> = [];
  let line: typeof lines[number] = [];
  let width = 0;
  words.forEach((word, index) => {
    const wordWidth = context.measureText(word.text).width;
    const nextWidth = width + (line.length ? gap : 0) + wordWidth;
    if (line.length && nextWidth > maxWidth) {
      lines.push(line);
      line = [];
      width = 0;
    }
    const delay = 4 + index * 4;
    const progress = tween(sourceFrame / 30, delay / 30, 9 / 30, smoothOut3);
    line.push({ ...word, width: wordWidth, progress });
    width += (line.length > 1 ? gap : 0) + wordWidth;
  });
  if (line.length) lines.push(line);
  const lineHeight = fontSize * 1.14;
  const totalHeight = lines.length * lineHeight;
  let y = plan.height / 2 - totalHeight / 2 + lineHeight * 0.72;
  context.textBaseline = "alphabetic";
  lines.forEach((tokens) => {
    const lineWidth = tokens.reduce((sum, token) => sum + token.width, 0) + gap * Math.max(0, tokens.length - 1);
    let x = (plan.width - lineWidth) / 2;
    tokens.forEach((token) => {
      const tokenScale = 1.28 - 0.28 * token.progress;
      context.save();
      context.globalAlpha *= token.progress;
      context.translate(x + token.width / 2, y);
      context.scale(tokenScale, tokenScale);
      context.font = `${token.accent ? "italic " : ""}${font}`;
      context.fillStyle = token.accent ? accent : ink;
      if ("filter" in context) context.filter = `blur(${(1 - token.progress) * 7}px)`;
      context.textAlign = "center";
      context.fillText(token.text, 0, 0);
      context.restore();
      x += token.width + gap;
    });
    y += lineHeight;
  });
  context.filter = "none";
  const underlineProgress = tween(sourceFrame, 16, 18, smoothOut3);
  context.fillStyle = accent;
  context.save();
  context.translate(plan.width / 2, y + 12);
  context.scale(underlineProgress, 1);
  context.fillRect(-underlineWidth / 2, 0, underlineWidth, 6);
  context.restore();
  const sub = stringProp(p, "sub", "");
  if (sub) {
    const subProgress = tween(sourceFrame, 10, 12);
    context.globalAlpha *= subProgress;
    context.font = '26px ui-monospace, SFMono-Regular, Menlo, monospace';
    context.fillStyle = "rgba(28,26,23,0.62)";
    context.textAlign = "center";
    const subDigits = stringProp(p, "subDigits", "");
    const digits = subDigits ? `${subDigits}  ` : "";
    context.fillText(`${digits}${sub.toUpperCase()}`, plan.width / 2, y + 54);
  }
  context.restore();
};
const smoothOut3 = (x: number) => smoothOut(x, 3);

const drawCaption = (context: CanvasRenderingContext2D, clip: BrowserRenderClip, frame: number, plan: BrowserRenderPlan) => {
  const p = clip.props;
  const sourceFrame = clip.inOffset + (frame - clip.start) * clip.speed;
  const duration = numberProp(p, "duration", clip.inOffset + clip.duration * clip.speed);
  const inProgress = clamp(sourceFrame / 8);
  const outProgress = clamp((duration - sourceFrame) / 8);
  const opacity = inProgress * outProgress;
  const bottom = numberProp(p, "bottom", 72);
  const fontSize = numberProp(p, "fontSize", 22);
  const color = stringProp(p, "color", "#615c54");
  const accent = stringProp(p, "accent", "#b5651d");
  const uppercase = boolProp(p, "uppercase", true);
  const text = stringProp(p, "text", "SEARCH · FILTER · OPEN");
  context.save();
  context.globalAlpha *= opacity;
  context.font = `${fontSize}px ui-monospace, SFMono-Regular, Menlo, monospace`;
  context.textBaseline = "alphabetic";
  context.textAlign = "center";
  if ("letterSpacing" in context) (context as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = "0.14em";
  const display = uppercase ? text.toUpperCase() : text;
  const textWidth = context.measureText(display).width;
  const centerX = plan.width / 2;
  const y = plan.height - bottom + (1 - inProgress) * 8;
  context.fillStyle = accent;
  context.fillRect(centerX - textWidth / 2 - 20, y - fontSize * 0.62, 6, 6);
  context.fillStyle = color;
  context.fillText(display, centerX, y);
  context.restore();
};

const drawFlash = (context: CanvasRenderingContext2D, clip: BrowserRenderClip, frame: number, plan: BrowserRenderPlan) => {
  const p = clip.props;
  const sourceFrame = clip.inOffset + (frame - clip.start) * clip.speed;
  const duration = Math.max(1, numberProp(p, "duration", clip.inOffset + clip.duration * clip.speed));
  const peak = numberProp(p, "peak", 0.85);
  const color = stringProp(p, "color", "#fff8eb");
  const progress = sourceFrame / duration;
  const opacity = progress <= 0.4
    ? peak * clamp(progress / 0.4)
    : peak * clamp((1 - progress) / 0.6);
  context.save();
  context.globalAlpha *= opacity;
  const gradient = context.createRadialGradient(plan.width / 2, plan.height * 0.45, 0, plan.width / 2, plan.height * 0.45, Math.max(plan.width, plan.height) * 0.72);
  gradient.addColorStop(0, color);
  gradient.addColorStop(0.55, color);
  gradient.addColorStop(1, "rgba(255,248,235,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, plan.width, plan.height);
  context.restore();
};

const drawLayer = async (
  context: CanvasRenderingContext2D,
  clip: BrowserRenderClip,
  outputFrame: number,
  plan: BrowserRenderPlan,
  videos: Map<string, VideoResource>,
  images: Map<string, HTMLImageElement>,
) => {
  if (outputFrame < clip.start || outputFrame >= clip.start + clip.duration) return;
  const frame = clip.inOffset + (outputFrame - clip.start) * clip.speed;
  const props = clip.props;
  context.save();
  context.globalAlpha *= clip.opacity;
  context.translate(plan.width / 2 + clip.x, plan.height / 2 + clip.y);
  context.scale(clip.scale, clip.scale);
  context.translate(-plan.width / 2, -plan.height / 2);
  try {
    if (clip.cardId === "video-clip") {
      const resource = videos.get(clip.id);
      if (!resource) throw new Error(`Missing decoded video: ${clip.label}`);
      const sourceTime = Math.max(0, frame / plan.fps);
      await seekVideo(resource.element, sourceTime);
      const rect = fitRect(resource.element.videoWidth, resource.element.videoHeight, plan.width, plan.height, stringProp(props, "fit", "contain"));
      context.fillStyle = "#000";
      context.fillRect(0, 0, plan.width, plan.height);
      context.drawImage(resource.element, rect.x, rect.y, rect.width, rect.height);
    } else if (clip.cardId === "image-clip") {
      const image = images.get(clip.id);
      if (!image) throw new Error(`Missing decoded image: ${clip.label}`);
      const rect = fitRect(image.naturalWidth, image.naturalHeight, plan.width, plan.height, stringProp(props, "fit", "contain"));
      context.fillStyle = "#000";
      context.fillRect(0, 0, plan.width, plan.height);
      context.drawImage(image, rect.x, rect.y, rect.width, rect.height);
    } else if (clip.cardId === "text-basic") {
      drawTextBasic(context, clip, outputFrame, plan);
    } else if (clip.cardId === "inkpress-title-card") {
      drawTitleCard(context, clip, outputFrame, plan);
    } else if (clip.cardId === "inkpress-caption") {
      drawCaption(context, clip, outputFrame, plan);
    } else if (clip.cardId === "inkpress-flash-cut") {
      drawFlash(context, clip, outputFrame, plan);
    } else if (clip.cardId === "bg-paper" || clip.cardId === "bg-white" || clip.cardId === "bg-ink") {
      const defaults: Record<string, string> = { "bg-paper": "#f2eee6", "bg-white": "#ffffff", "bg-ink": "#0a0908" };
      context.fillStyle = stringProp(props, "color", defaults[clip.cardId]);
      context.fillRect(0, 0, plan.width, plan.height);
    } else if (clip.cardId === "bg-paper-glow") {
      context.fillStyle = stringProp(props, "color", "#f2eee6");
      context.fillRect(0, 0, plan.width, plan.height);
      const glow = numberProp(props, "glow", 0.85);
      const gradient = context.createRadialGradient(plan.width / 2, plan.height / 2, 0, plan.width / 2, plan.height / 2, Math.max(plan.width, plan.height) * 0.8);
      gradient.addColorStop(0, `rgba(255,252,244,${glow})`);
      gradient.addColorStop(0.65, `rgba(255,252,244,${glow})`);
      gradient.addColorStop(1, "rgba(255,252,244,0)");
      context.fillStyle = gradient;
      context.fillRect(0, 0, plan.width, plan.height);
    }
  } finally {
    context.restore();
  }
};

const clipProps = (clip: BrowserRenderClip, project: ProjectData) => {
  const card = CARDS[clip.cardId];
  if (!card) return clip.props;
  const props = themedProps(MANIFEST, card, project.themeId, clip.props, project.themeColors);
  if (card.durationProp) props[card.durationProp] = Math.max(1, Math.round(clip.inOffset + clip.duration * clip.speed));
  return props;
};

const loadAudioBuffer = async (blob: Blob, audioContext: AudioContext): Promise<DecodedAudio> => {
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track) return { buffer: null, failed: false };
  } catch {
    return { buffer: null, failed: false };
  } finally {
    input.dispose();
  }
  try {
    return { buffer: await audioContext.decodeAudioData(await blob.arrayBuffer()), failed: false };
  } catch {
    return { buffer: null, failed: true };
  }
};

const mixAudioChunk = (
  audio: AudioBufferSource,
  sampleRate: number,
  audioClips: Array<{ clip: BrowserRenderClip; buffer: AudioBuffer }>,
  frameStart: number,
  sampleCount: number,
  fps: number,
) => {
  const chunk = new AudioBuffer({ length: sampleCount, numberOfChannels: 2, sampleRate });
  const leftOut = chunk.getChannelData(0);
  const rightOut = chunk.getChannelData(1);
  for (const { clip, buffer } of audioClips) {
    const volume = numberProp(clip.props, "volume", 1);
    if (clip.props.muted === true || volume <= 0) continue;
    const sourceLeft = buffer.getChannelData(0);
    const sourceRight = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : sourceLeft;
    const sourceStartSample = Math.round((clip.inOffset / fps) * buffer.sampleRate);
    const clipStartSample = Math.round((clip.start / fps) * sampleRate);
    const clipEndSample = Math.round(((clip.start + clip.duration) / fps) * sampleRate);
    const from = Math.max(frameStart, clipStartSample);
    const to = Math.min(frameStart + sampleCount, clipEndSample);
    for (let outputSample = from; outputSample < to; outputSample++) {
      const localSeconds = (outputSample - clipStartSample) / sampleRate;
      const sourceIndex = sourceStartSample + Math.floor(localSeconds * clip.speed * buffer.sampleRate);
      if (sourceIndex < 0 || sourceIndex >= buffer.length) continue;
      const i = outputSample - frameStart;
      leftOut[i] += sourceLeft[sourceIndex] * volume;
      rightOut[i] += sourceRight[sourceIndex] * volume;
    }
  }
  for (let i = 0; i < sampleCount; i++) {
    leftOut[i] = clamp(leftOut[i], -1, 1);
    rightOut[i] = clamp(rightOut[i], -1, 1);
  }
  return audio.add(chunk);
};

export const renderBrowserTimeline = async (
  plan: BrowserRenderPlan,
  project: ProjectData,
  onProgress: BrowserRenderProgress = () => {},
): Promise<{ blob: Blob; audioWarnings: number }> => {
  if (typeof VideoEncoder === "undefined") {
    throw new Error("This browser does not support WebCodecs video encoding. Try a current version of Chrome, Edge, or Safari.");
  }
  if (typeof AudioContext === "undefined") throw new Error("This browser does not support Web Audio processing.");
  if (typeof VideoEncoder.isConfigSupported === "function") {
    const support = await VideoEncoder.isConfigSupported({
      codec: "avc1.42001f",
      width: plan.width,
      height: plan.height,
      bitrate: 8_000_000,
      framerate: plan.fps,
    });
    if (!support.supported) throw new Error("This browser cannot encode H.264 MP4 at the project dimensions and frame rate. Try a current desktop Chrome, Edge, or Safari, or reduce the project size.");
  }
  if (!(await canEncodeAudio("aac", { numberOfChannels: 2, sampleRate: 48_000 }))) {
    const { registerAacEncoder } = await import("@mediabunny/aac-encoder");
    registerAacEncoder();
  }

  const audioContext = new AudioContext({ sampleRate: 48_000 });
  const objectUrls = new Map<string, string>();
  const mediaBlobs = new Map<string, Blob>();
  const videos = new Map<string, VideoResource>();
  const images = new Map<string, HTMLImageElement>();
  let audioWarnings = 0;
  try {
    await audioContext.resume();
    await document.fonts?.ready;
    const blobFor = async (file: string) => {
      const existing = objectUrls.get(file);
      if (existing) return { blob: mediaBlobs.get(file), url: existing };
      const blob = await fetchMediaBlob(file);
      const url = URL.createObjectURL(blob);
      objectUrls.set(file, url);
      mediaBlobs.set(file, blob);
      return { blob, url };
    };

    const videoClips = plan.visualClips.filter((clip) => clip.cardId === "video-clip");
    const imageClips = plan.visualClips.filter((clip) => clip.cardId === "image-clip");
    const assetCount = videoClips.length + imageClips.length + plan.audioClips.length + videoClips.filter((clip) => !clip.props.muted && numberProp(clip.props, "volume", 1) > 0).length;
    let loadedAssets = 0;
    const tickLoading = () => onProgress("loading", assetCount ? loadedAssets / assetCount : 1);
    for (const clip of videoClips) {
      tickLoading();
      const { blob, url } = await blobFor(String(clip.props.file));
      const element = await loadVideo(url);
      videos.set(clip.id, { element, url });
      loadedAssets++;
      tickLoading();
      if (!element.videoWidth || !element.videoHeight) throw new Error(`Invalid video dimensions: ${clip.label}`);
      void blob;
    }
    for (const clip of imageClips) {
      tickLoading();
      const { url } = await blobFor(String(clip.props.file));
      const image = await loadImage(url);
      images.set(clip.id, image);
      loadedAssets++;
      tickLoading();
    }

    const audioInputClips = [
      ...plan.audioClips.map((clip) => ({ clip, file: String(clip.props.file), expected: true })),
      ...videoClips
        .filter((clip) => clip.props.muted !== true && numberProp(clip.props, "volume", 1) > 0)
        .map((clip) => ({ clip, file: String(clip.props.file), expected: false })),
    ];
    const decodedByFile = new Map<string, Promise<DecodedAudio>>();
    const mixSources: Array<{ clip: BrowserRenderClip; buffer: AudioBuffer }> = [];
    for (const { clip, file, expected } of audioInputClips) {
      tickLoading();
      try {
        const cached = decodedByFile.get(file);
        let pending = cached;
        if (!pending) {
          pending = (async () => {
            const blob = mediaBlobs.get(file) ?? (await fetchMediaBlob(file));
            return loadAudioBuffer(blob, audioContext);
          })();
          decodedByFile.set(file, pending);
        }
        const decoded = await pending;
        if (decoded.buffer) mixSources.push({ clip, buffer: decoded.buffer });
        else if (decoded.failed || expected) audioWarnings++;
      } catch {
        audioWarnings++;
      }
      loadedAssets++;
      tickLoading();
    }

    const canvas = document.createElement("canvas");
    canvas.width = plan.width;
    canvas.height = plan.height;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("Could not create a browser canvas for MP4 export.");

    const target = new BufferTarget();
    const output = new Output({ format: new Mp4OutputFormat(), target });
    const videoSource = new CanvasSource(canvas, { codec: "avc", quality: new Quality("medium") });
    const audioSource = new AudioBufferSource({ codec: "aac", quality: new Quality({ bitrate: 192_000 }) });
    output.addVideoTrack(videoSource, { frameRate: plan.fps });
    output.addAudioTrack(audioSource);
    await output.start();

    const totalFrames = plan.durationFrames;
    const projectBackground = themedBackground(project, MANIFEST) ?? plan.background;
    const preparedVisualClips = plan.visualClips.map((clip) => {
      const card = CARDS[clip.cardId];
      return card ? { ...clip, props: clipProps(clip, project) } : clip;
    });
    for (let frame = 0; frame < totalFrames; frame++) {
      context.fillStyle = projectBackground;
      context.fillRect(0, 0, plan.width, plan.height);
      for (const clip of preparedVisualClips) {
        if (frame >= clip.start && frame < clip.start + clip.duration) {
          await drawLayer(context, clip, frame, plan, videos, images);
        }
      }
      await videoSource.add(frame / plan.fps, 1 / plan.fps);
      if (frame % Math.max(1, Math.round(plan.fps / 2)) === 0 || frame === totalFrames - 1) {
        onProgress("encoding", 0.8 * ((frame + 1) / totalFrames));
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      }
    }

    const sampleRate = audioContext.sampleRate;
    const totalSamples = Math.round((totalFrames / plan.fps) * sampleRate);
    const samplesPerChunk = sampleRate;
    let sampleOffset = 0;
    while (sampleOffset < totalSamples) {
      const count = Math.min(samplesPerChunk, totalSamples - sampleOffset);
      await mixAudioChunk(audioSource, sampleRate, mixSources, sampleOffset, count, plan.fps);
      sampleOffset += count;
      onProgress("encoding", 0.8 + 0.19 * (sampleOffset / Math.max(1, totalSamples)));
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
    for (const { element } of videos.values()) {
      element.pause();
      element.removeAttribute("src");
      element.load();
    }
    for (const url of objectUrls.values()) URL.revokeObjectURL(url);
    await audioContext.close().catch(() => {});
  }
};
