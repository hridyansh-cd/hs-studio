import { useState, useEffect } from "react";

const NUM_BARS = 300;

export function useAudioWaveform(videoFile: File | null): {
  bars: number[];
  loading: boolean;
} {
  const [bars, setBars] = useState<number[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!videoFile) {
      setBars([]);
      setLoading(false);
      return;
    }

    // Skip waveform for very large files (>80 MB) to prevent OOM on mobile
    if (videoFile.size > 80 * 1024 * 1024) {
      setBars([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setBars([]);

    (async () => {
      try {
        const arrayBuffer = await videoFile.arrayBuffer();
        if (cancelled) return;

        const audioCtx = new AudioContext();
        const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
        if (cancelled) {
          audioCtx.close();
          return;
        }

        const channelData = audioBuffer.getChannelData(0);
        const samplesPerBar = Math.floor(channelData.length / NUM_BARS);
        const result: number[] = new Array(NUM_BARS);

        for (let i = 0; i < NUM_BARS; i++) {
          const start = i * samplesPerBar;
          const end = Math.min(start + samplesPerBar, channelData.length);
          let peak = 0;
          for (let j = start; j < end; j++) {
            const abs = Math.abs(channelData[j]);
            if (abs > peak) peak = abs;
          }
          result[i] = peak;
        }

        audioCtx.close();
        if (!cancelled) {
          setBars(result);
          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          setBars([]);
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [videoFile]);

  return { bars, loading };
}
