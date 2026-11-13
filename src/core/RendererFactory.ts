import { ACESFilmicToneMapping, SRGBColorSpace, WebGPURenderer } from "three/webgpu";

export type BackendName = "webgpu" | "webgl2";

export interface RendererOptions {
  canvas: HTMLCanvasElement;
  /** Skip WebGPU even where it is available (`?renderer=webgl`). */
  forceWebGL: boolean;
  antialias: boolean;
}

export interface RendererHandle {
  renderer: WebGPURenderer;
  /** The backend that actually initialized. */
  backend: BackendName;
  /**
   * Registers a callback for when the GPU device or WebGL context is lost.
   * The message describes the cause. May fire more than once.
   */
  watchDeviceLoss(callback: (message: string) => void): void;
}

/** The part of a WebGPU device this module needs (avoids a dependency on WebGPU type packages). */
interface LosableDevice {
  lost: Promise<{ reason?: string; message?: string }>;
}

/**
 * Creates and initializes the renderer. three's WebGPURenderer uses WebGPU
 * when the browser supports it and otherwise falls back to WebGL2 on its own;
 * `forceWebGL` selects the fallback explicitly. Rejects when neither works.
 */
export async function createRenderer(options: RendererOptions): Promise<RendererHandle> {
  const renderer = new WebGPURenderer({
    canvas: options.canvas,
    antialias: options.antialias,
    forceWebGL: options.forceWebGL,
    powerPreference: "high-performance",
  });
  await renderer.init();
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.outputColorSpace = SRGBColorSpace;
  const isWebGPU = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend === true;

  const watchDeviceLoss = (callback: (message: string) => void): void => {
    const describe = (message: string | undefined, reason: string | null | undefined): string =>
      `${message !== undefined && message !== "" ? message : "Unknown cause"}${reason ? ` (${reason})` : ""}`;
    // three reports WebGL context loss and most WebGPU losses through this hook...
    renderer.onDeviceLost = (info) => callback(describe(info.message, info.reason));
    // ...but skips WebGPU losses whose reason is "destroyed", assuming the app disposed
    // the renderer. Browsers also report "destroyed" when they tear the device down
    // themselves, so the device is watched directly as well. The caller ignores
    // losses that follow its own dispose().
    const device = (renderer.backend as { device?: LosableDevice | null }).device;
    if (isWebGPU && device) void device.lost.then((info) => callback(describe(info.message, info.reason)));
  };

  return { renderer, backend: isWebGPU ? "webgpu" : "webgl2", watchDeviceLoss };
}
