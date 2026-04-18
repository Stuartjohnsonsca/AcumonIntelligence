// Reusable video / audio recorder types.
//
// The VideoRecorder component is intentionally generic. It is used by the
// Risk Forum Behavioural Assessment flow but has no dependency on it and
// can be dropped into any tool that needs to capture spoken evidence with
// optional transcription.

export type RecorderMode = 'video' | 'audio';

export interface RecorderResult {
  blob: Blob;
  mimeType: string;
  durationSec: number;
  transcript?: string;        // populated when transcribe=true and API succeeds
  transcriptError?: string;   // set if transcription was attempted and failed
}

export interface VideoRecorderProps {
  // Called when the user confirms their recording. The blob is owned by the
  // caller afterwards (VideoRecorder does not persist it).
  onComplete: (result: RecorderResult) => void;

  // Called if the user cancels the recording session.
  onCancel?: () => void;

  // Default 'video'. 'audio' suppresses the camera and shows a microphone UI.
  mode?: RecorderMode;

  // If true, audio is sent to /api/transcribe after recording and the
  // transcript is included in the result. Defaults to true.
  transcribe?: boolean;

  // Optional hard cap on recording duration in seconds. Auto-stops at limit.
  // Defaults to 300 (5 minutes) to protect against runaway recordings.
  maxDurationSec?: number;

  // Optional prompt shown above the recorder to frame the question.
  prompt?: string;

  // Visual styling: dark theme (default) matches the Risk Forum aesthetic.
  // light theme provides a pale UI for use in other tools.
  theme?: 'dark' | 'light';

  // Shows a Download button in the review phase so the user can save the
  // raw recording to their device. Defaults to true. Callers that persist
  // the blob themselves (upload, IndexedDB) may still want this on as a
  // secondary option for the subject. Separate from transcription.
  allowDownload?: boolean;

  // Optional base name for the downloaded file (extension appended based on
  // the MIME type of the recording). Defaults to "recording".
  downloadFilename?: string;
}
