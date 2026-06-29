/**
 * Hook: push-to-talk voice form-fill.
 *
 * Records audio via MediaRecorder, POSTs to /api/voice/intent with the
 * form's field specs, returns candidate fills for human confirmation.
 *
 * Layer contract (directive 10): the browser sends audio bytes to the backend
 * only — it never calls an external ASR or model API directly.
 *
 * Confirm-before-commit: fills are candidates; the caller must show them for
 * explicit confirmation before writing to form state.
 */
import { useCallback, useRef, useState } from "react";
import { getAuthHeaders } from "@/lib/api";

export interface FieldSpec {
  name: string;
  label: string;
  hint?: string;
}

export interface FieldFill {
  field: string;
  value: string;
  confidence: number;
}

export interface VoiceIntentResponse {
  transcript: string;
  fills: FieldFill[];
  asr_model: string;
  structure_model: string;
  endpoint: string;
}

interface UseVoiceFillState {
  recording: boolean;
  busy: boolean;
  fills: FieldFill[];
  transcript: string;
  error: string | null;
}

interface UseVoiceFillReturn extends UseVoiceFillState {
  start: () => Promise<void>;
  stop: () => void;
  reset: () => void;
  supported: boolean;
}

/** Pick the best supported audio MIME for MediaRecorder. */
function preferredMime(): string {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/ogg",
    "audio/mp4",
  ];
  for (const m of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m)) {
      return m;
    }
  }
  return "";
}

export function useVoiceFill(fields: FieldSpec[]): UseVoiceFillReturn {
  const [state, setState] = useState<UseVoiceFillState>({
    recording: false,
    busy: false,
    fills: [],
    transcript: "",
    error: null,
  });

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  const supported = typeof MediaRecorder !== "undefined" &&
    typeof navigator?.mediaDevices?.getUserMedia === "function";

  const start = useCallback(async () => {
    if (!supported) {
      setState((s) => ({ ...s, error: "Audioaufnahme wird von diesem Browser nicht unterstützt" }));
      return;
    }

    setState((s) => ({ ...s, error: null, fills: [], transcript: "" }));

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setState((s) => ({ ...s, error: "Mikrofonzugriff verweigert" }));
      return;
    }

    streamRef.current = stream;
    chunksRef.current = [];

    const mime = preferredMime();
    const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    mediaRecorderRef.current = recorder;

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };

    recorder.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      streamRef.current = null;

      const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
      chunksRef.current = [];

      if (blob.size === 0) {
        setState((s) => ({ ...s, busy: false, error: "Aufnahme leer — bitte erneut versuchen" }));
        return;
      }

      setState((s) => ({ ...s, busy: true }));

      const fd = new FormData();
      fd.append("audio", blob, "recording.webm");
      fd.append("fields", JSON.stringify(fields));

      try {
        const res = await fetch("/api/voice/intent", {
          method: "POST",
          headers: getAuthHeaders(),
          body: fd,
        });

        if (!res.ok) {
          const text = await res.text().catch(() => `HTTP ${res.status}`);
          let detail = `HTTP ${res.status}`;
          try { detail = (JSON.parse(text) as { detail?: string }).detail ?? detail; } catch { /* ignore */ }
          setState((s) => ({ ...s, busy: false, error: detail }));
          return;
        }

        const data = (await res.json()) as VoiceIntentResponse;
        setState((s) => ({
          ...s,
          busy: false,
          fills: data.fills,
          transcript: data.transcript,
          error: data.fills.length === 0 ? "Keine Felder erkannt — bitte erneut versuchen" : null,
        }));
      } catch (err) {
        setState((s) => ({
          ...s,
          busy: false,
          error: err instanceof Error ? err.message : "Netzwerkfehler",
        }));
      }
    };

    recorder.start(250);
    setState((s) => ({ ...s, recording: true }));
  }, [fields, supported]);

  const stop = useCallback(() => {
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
    }
    setState((s) => ({ ...s, recording: false }));
  }, []);

  const reset = useCallback(() => {
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
      streamRef.current?.getTracks().forEach((t) => t.stop());
    }
    mediaRecorderRef.current = null;
    streamRef.current = null;
    chunksRef.current = [];
    setState({ recording: false, busy: false, fills: [], transcript: "", error: null });
  }, []);

  return { ...state, start, stop, reset, supported };
}
