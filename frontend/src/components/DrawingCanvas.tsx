import React, { useState } from "react";

/** Deterministic stroke geometry: the hand works from the lower left upward. */
const STROKES = [
  { left: 8, top: 76, width: 26, rotate: -14 },
  { left: 16, top: 66, width: 22, rotate: -9 },
  { left: 25, top: 58, width: 20, rotate: -5 },
  { left: 33, top: 50, width: 18, rotate: -2 },
  { left: 43, top: 44, width: 17, rotate: 1 },
  { left: 51, top: 38, width: 15, rotate: 4 },
  { left: 57, top: 32, width: 14, rotate: 7 },
  { left: 63, top: 27, width: 12, rotate: 10 },
  { left: 19, top: 85, width: 31, rotate: -18 },
  { left: 38, top: 72, width: 25, rotate: -6 },
  { left: 55, top: 62, width: 21, rotate: 3 },
  { left: 65, top: 52, width: 17, rotate: 9 },
  { left: 71, top: 41, width: 14, rotate: 14 },
  { left: 78, top: 31, width: 12, rotate: 18 },
] as const;

interface DrawingCanvasProps {
  /**
   * 0-100 while a run is drawing, `null` before the first report, `undefined`
   * when nothing is running. Strokes only ever come from this real number.
   */
  percent?: number | null;
  /**
   * A still of the frame the render has just drawn. Preferred over the strokes:
   * the strokes stand in only until the first real frame arrives.
   */
  frameSrc?: string;
  /** Real content for the sheet: the rendered video, or the staged source. */
  media?: React.ReactNode;
  /** The source the run is drawing over, held under it as an onion skin. */
  underlay?: React.ReactNode;
  /** What the sheet says when it has nothing on it yet. */
  empty?: React.ReactNode;
  /** Tailwind aspect class for the sheet's working area. */
  className?: string;
}

/**
 * The lit sheet's working area.
 *
 * With a result it holds the real artifact; while a run is drawing it holds the
 * drawing itself — pencil strokes accumulating from the reported percent, so
 * the sheet fills in at the pace the backend actually reports. It is not a
 * spinner and not a decoration: an idle sheet has no strokes at all.
 */
export const DrawingCanvas: React.FC<DrawingCanvasProps> = ({
  percent,
  frameSrc,
  media,
  underlay,
  empty,
  className,
}) => {
  const known = typeof percent === "number";
  const drawn = known
    ? Math.round((Math.min(100, Math.max(0, percent)) / 100) * STROKES.length)
    : 0;
  // A preview lives only as long as the render that wrote it, so the last one
  // can 404 the instant the run ends: drop it rather than show a broken image.
  const [failedFrameSrc, setFailedFrameSrc] = useState("");
  const showFrame = Boolean(frameSrc) && frameSrc !== failedFrameSrc;

  return (
    <div
      className={`relative overflow-hidden rounded-[3px] border border-sheet-line bg-sheet-raised ${className ?? "aspect-video"}`}
    >
      {media ? (
        media
      ) : (
        <>
          {/* the paper's faint guide grid — this is a drawing surface, not a texture */}
          <div
            aria-hidden="true"
            className="absolute inset-0 opacity-[0.35]"
            style={{
              backgroundImage:
                "repeating-linear-gradient(to right, var(--color-sheet-line) 0 1px, transparent 1px 48px), repeating-linear-gradient(to bottom, var(--color-sheet-line) 0 1px, transparent 1px 48px)",
            }}
          />
          {underlay && (
            /* the source the run is drawing over, held under it as an onion skin */
            <div
              aria-hidden="true"
              className="absolute inset-0 flex items-center justify-center opacity-25"
            >
              {underlay}
            </div>
          )}
          {known &&
            !showFrame &&
            STROKES.slice(0, drawn).map((stroke, index) => (
              <div
                key={`${stroke.left}-${stroke.top}`}
                className="ghost"
                style={{
                  left: `${stroke.left}%`,
                  top: `${stroke.top}%`,
                  width: `${stroke.width}%`,
                  transform: `rotate(${stroke.rotate}deg)`,
                  opacity: 0.28 + index * 0.045,
                }}
              />
            ))}
          {/* the real frame, the moment the render reports it: the strokes above
              stand in only until the first one arrives */}
          {frameSrc && showFrame && (
            <img
              src={frameSrc}
              alt="Frame being drawn"
              /* multiplied onto the sheet, not laid over it: the frame's own
                 paper disappears into the paper below, so the guide grid and
                 the onion-skinned source keep showing through the drawing */
              className="absolute inset-0 h-full w-full object-contain mix-blend-multiply"
              onError={() => setFailedFrameSrc(frameSrc)}
            />
          )}
          {/* the sheet only explains itself while it is empty: once strokes are
              drawing, the instruction would be a lie about what is happening */}
          {!known && empty && (
            <div className="absolute inset-0 flex items-center justify-center p-8 text-center">
              {empty}
            </div>
          )}
        </>
      )}
    </div>
  );
};
