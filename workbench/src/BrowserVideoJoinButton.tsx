import React, { useMemo, useState } from "react";
import { useT } from "./i18n";
import { useStore } from "./store";
import { buildVideoJoinPlan, VideoJoinPlanError } from "./browserVideoExportPlan";
import type { VideoJoinProgress } from "./browserVideoExport";

const safeFileName = (name: string) =>
  (name.trim().replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, "-").slice(0, 64) || "video-shotcraft") + ".mp4";

export const BrowserVideoJoinButton: React.FC = () => {
  const t = useT();
  const project = useStore((state) => state.project);
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<"idle" | "running" | "done" | "error">("idle");
  const [progress, setProgress] = useState<{ phase: VideoJoinProgress extends (phase: infer P, ratio: number) => void ? P : never; ratio: number }>({ phase: "loading", ratio: 0 });
  const [error, setError] = useState("");
  const [audioWarnings, setAudioWarnings] = useState(0);
  const planResult = useMemo(() => {
    try {
      return { plan: buildVideoJoinPlan(project), error: null as VideoJoinPlanError | null };
    } catch (reason) {
      return {
        plan: null,
        error: reason instanceof VideoJoinPlanError ? reason : new VideoJoinPlanError("invalidProject"),
      };
    }
  }, [project]);

  const close = () => {
    setOpen(false);
    setStatus("idle");
    setError("");
    setAudioWarnings(0);
  };

  const startExport = async () => {
    if (!planResult.plan || status === "running") return;
    setStatus("running");
    setError("");
    setProgress({ phase: "loading", ratio: 0 });
    try {
      const { renderVideoJoin } = await import("./browserVideoExport");
      const result = await renderVideoJoin(planResult.plan, (phase, ratio) => {
        setProgress({ phase, ratio });
      });
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
      setError(message.includes("does not support WebCodecs")
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

            {planResult.plan ? (
              <>
                <div className="browser-export-summary">
                  <strong>{t("join.clipCount", { n: planResult.plan.clips.length })}</strong>
                  <span>{t("join.total", { duration: (planResult.plan.durationFrames / planResult.plan.fps).toFixed(1) })}</span>
                </div>
                <ol className="browser-export-clips">
                  {planResult.plan.clips.map((clip, index) => (
                    <li key={clip.id}>
                      <span className="browser-export-index">{index + 1}</span>
                      <span className="browser-export-name" title={clip.label}>{clip.label}</span>
                      <span className="browser-export-duration">{(clip.durationFrames / planResult.plan!.fps).toFixed(1)}s</span>
                    </li>
                  ))}
                </ol>
                {planResult.plan.ignoredLayerCount > 0 && (
                  <div className="browser-export-warning" role="note">
                    {t("join.otherLayers")} ({planResult.plan.ignoredLayerCount})
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
              <button className="btn primary" onClick={startExport} disabled={!planResult.plan || status === "running"}>
                {status === "running" ? phaseText : t("join.create")}
              </button>
            </footer>
          </section>
        </div>
      )}
    </>
  );
};
