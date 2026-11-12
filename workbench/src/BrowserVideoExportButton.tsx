import React, { useMemo, useState } from "react";
import { useT } from "./i18n";
import { useStore } from "./store";
import { buildBrowserRenderPlan, BrowserRenderPlanError } from "./browserVideoExportPlan";
import type { BrowserRenderProgress } from "./browserVideoExport";

const safeFileName = (name: string) =>
  (name.trim().replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, "-").slice(0, 64) || "video-shotcraft") + ".mp4";
const MOTION_IDS = new Set(["text-basic", "inkpress-title-card", "inkpress-caption", "inkpress-flash-cut"]);

export const BrowserVideoExportButton: React.FC = () => {
  const t = useT();
  const project = useStore((state) => state.project);
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<"idle" | "running" | "done" | "error">("idle");
  const [progress, setProgress] = useState<{ phase: BrowserRenderProgress extends (phase: infer P, ratio: number) => void ? P : never; ratio: number }>({ phase: "loading", ratio: 0 });
  const [error, setError] = useState("");
  const [audioWarnings, setAudioWarnings] = useState(0);
  const planResult = useMemo(() => {
    try {
      return { plan: buildBrowserRenderPlan(project), error: null as BrowserRenderPlanError | null };
    } catch (reason) {
      return {
        plan: null,
        error: reason instanceof BrowserRenderPlanError ? reason : new BrowserRenderPlanError("invalidProject"),
      };
    }
  }, [project]);
  const plan = planResult.plan;
  const unsupported = plan?.unsupportedLayers ?? [];
  const close = () => {
    setOpen(false);
    setStatus("idle");
    setError("");
    setAudioWarnings(0);
  };
  const startExport = async () => {
    if (!plan || unsupported.length || status === "running") return;
    setStatus("running");
    setError("");
    setProgress({ phase: "loading", ratio: 0 });
    try {
      const { renderBrowserTimeline } = await import("./browserVideoExport");
      const result = await renderBrowserTimeline(plan, project, (phase, ratio) => setProgress({ phase, ratio }));
      const url = URL.createObjectURL(result.blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = safeFileName(project.name);
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setAudioWarnings(result.audioWarnings);
      setStatus("done");
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      setError(message.includes("WebCodecs") || message.includes("H.264")
        ? t("join.support")
        : `${t("join.failed")} ${message}`);
      setStatus("error");
    }
  };
  const phaseText = progress.phase === "loading"
    ? t("join.loading", { pct: Math.round(progress.ratio * 100) })
    : progress.phase === "finalizing"
      ? t("join.finalizing")
      : t("join.encoding", { pct: Math.round(progress.ratio * 100) });
  const audioCount = (plan?.audioClips.length ?? 0) + (plan?.visualClips.filter((clip) => clip.cardId === "video-clip").length ?? 0);
  const motionCount = plan?.visualClips.filter((clip) => MOTION_IDS.has(clip.cardId)).length ?? 0;
  const exportItems = plan ? [...plan.visualClips, ...plan.audioClips].sort((a, b) => a.start - b.start) : [];
  return (
    <>
      <button className="btn primary" title={t("join.title")} onClick={() => setOpen(true)}>
        {t("join.button")}
      </button>
      {open && (
        <div className="browser-export-backdrop" onMouseDown={(event) => {
          if (event.target === event.currentTarget && status !== "running") close();
        }}>
          <section className="browser-export-dialog" role="dialog" aria-modal="true" aria-labelledby="browser-export-title">
            <header className="browser-export-head">
              <div>
                <h2 id="browser-export-title">{t("join.title")}</h2>
                <p>{t("join.description")}</p>
              </div>
              <button className="mini browser-export-x" aria-label={t("join.close")} onClick={close} disabled={status === "running"}>×</button>
            </header>
            {plan ? (
              <>
                <div className="browser-export-summary">
                  <strong>{t("join.clipCount", { n: plan.visualClips.filter((clip) => clip.cardId === "video-clip").length })}</strong>
                  <span>{t("join.motionCount", { n: motionCount })}</span>
                  <span>{t("join.audioCount", { n: audioCount })}</span>
                  <span>{t("join.total", { duration: (plan.durationFrames / plan.fps).toFixed(1) })}</span>
                </div>
                {exportItems.length > 0 && (
                  <ol className="browser-export-clips">
                    {exportItems.slice(0, 10).map((clip, index) => (
                      <li key={clip.id}>
                        <span className="browser-export-index">{index + 1}</span>
                        <span className="browser-export-name" title={`${clip.label} · ${clip.cardId}`}>{clip.label}</span>
                        <span className="browser-export-duration">{(clip.start / plan.fps).toFixed(1)}s</span>
                      </li>
                    ))}
                    {exportItems.length > 10 && <li className="browser-export-more">{t("join.more", { n: exportItems.length - 10 })}</li>}
                  </ol>
                )}
                {unsupported.length > 0 && (
                  <div className="browser-export-warning" role="alert">
                    {t("join.unsupported", { n: unsupported.length, items: [...new Set(unsupported.map((layer) => layer.cardId))].slice(0, 5).join(", ") })}
                  </div>
                )}
              </>
            ) : (
              <div className="browser-export-warning" role="alert">
                {t(`join.${planResult.error?.code ?? "invalidProject"}`)}
              </div>
            )}
            <div className="browser-export-privacy">{t("join.privacy")}</div>
            {status === "running" && (
              <div className="browser-export-progress" role="status" aria-live="polite">
                <div className="browser-export-progress-label"><span>{phaseText}</span><span>{Math.round(progress.ratio * 100)}%</span></div>
                <div className="browser-export-progress-track"><span style={{ width: `${Math.max(2, progress.ratio * 100)}%` }} /></div>
              </div>
            )}
            {status === "done" && (
              <div className="browser-export-success" role="status">
                {t("join.done")}
                {audioWarnings > 0 && <div className="browser-export-audio-warning">{t("join.audioWarning", { n: audioWarnings })}</div>}
              </div>
            )}
            {status === "error" && <div className="browser-export-warning" role="alert">{error}</div>}
            <footer className="browser-export-actions">
              <button className="btn" onClick={close} disabled={status === "running"}>{t("join.close")}</button>
              <button className="btn primary" onClick={startExport} disabled={!plan || unsupported.length > 0 || status === "running"}>
                {status === "running" ? phaseText : t("join.create")}
              </button>
            </footer>
          </section>
        </div>
      )}
    </>
  );
};
