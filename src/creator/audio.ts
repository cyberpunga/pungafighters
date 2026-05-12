export interface RecorderSession {
  stop: () => Promise<Blob>;
  cancel: () => void;
}

export async function startVoiceRecording(): Promise<RecorderSession> {
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    throw new Error("Audio recording is not supported by this browser.");
  }

  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const chunks: Blob[] = [];
  const recorder = new MediaRecorder(stream);
  recorder.addEventListener("dataavailable", (event) => {
    if (event.data.size > 0) {
      chunks.push(event.data);
    }
  });
  recorder.start();

  return {
    stop: () =>
      new Promise((resolve) => {
        recorder.addEventListener(
          "stop",
          () => {
            stream.getTracks().forEach((track) => track.stop());
            resolve(new Blob(chunks, { type: recorder.mimeType || "audio/webm" }));
          },
          { once: true },
        );
        recorder.stop();
      }),
    cancel: () => {
      stream.getTracks().forEach((track) => track.stop());
      if (recorder.state !== "inactive") {
        recorder.stop();
      }
    },
  };
}
