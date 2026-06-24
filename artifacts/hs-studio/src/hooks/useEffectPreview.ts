import { useMemo } from "react";
import type { Effect } from "@/types";

export interface EffectPreviewStyle {
  transform: string;
  opacity: number;
}

/**
 * Computes the live CSS style to apply to the video element
 * based on which effect (if any) is active at currentTime.
 */
export function useEffectPreview(
  effects: Effect[],
  currentTime: number
): EffectPreviewStyle {
  return useMemo(() => {
    const active = effects.find(
      (fx) => currentTime >= fx.start && currentTime <= fx.end
    );

    if (!active) {
      return { transform: "scale(1)", opacity: 1 };
    }

    const span = active.end - active.start;
    const progress = span > 0 ? (currentTime - active.start) / span : 0;

    switch (active.type) {
      case "zoom-in":
        return { transform: `scale(${(1 + progress * 0.35).toFixed(4)})`, opacity: 1 };
      case "zoom-out":
        return { transform: `scale(${(1.35 - progress * 0.35).toFixed(4)})`, opacity: 1 };
      case "fade-in":
        return { transform: "scale(1)", opacity: Math.max(0.05, progress) };
      case "fade-out":
        return { transform: "scale(1)", opacity: Math.max(0.05, 1 - progress) };
      default:
        return { transform: "scale(1)", opacity: 1 };
    }
  }, [effects, currentTime]);
}
