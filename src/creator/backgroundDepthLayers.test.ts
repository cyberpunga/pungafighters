import { describe, expect, it } from "vitest";
import { createBackgroundDepthLayerMasks, type BackgroundDepthImageData } from "./backgroundDepthLayers";

describe("background depth layer masks", () => {
  it("assigns upper pixels mostly to the far layer", () => {
    const masks = createBackgroundDepthLayerMasks(createVerticalImage());
    const topPixel = 1;

    expect(masks.far[topPixel]).toBeGreaterThan(masks.mid[topPixel]);
    expect(masks.far[topPixel]).toBeGreaterThan(masks.near[topPixel]);
  });

  it("assigns lower pixels mostly to the near layer", () => {
    const masks = createBackgroundDepthLayerMasks(createVerticalImage());
    const bottomPixel = 10;

    expect(masks.near[bottomPixel]).toBeGreaterThan(masks.mid[bottomPixel]);
    expect(masks.near[bottomPixel]).toBeGreaterThan(masks.far[bottomPixel]);
  });

  it("keeps transparent pixels out of every layer", () => {
    const masks = createBackgroundDepthLayerMasks({
      width: 1,
      height: 1,
      data: new Uint8ClampedArray([255, 255, 255, 0]),
    });

    expect(masks.far[0]).toBe(0);
    expect(masks.mid[0]).toBe(0);
    expect(masks.near[0]).toBe(0);
  });
});

function createVerticalImage(): BackgroundDepthImageData {
  const width = 3;
  const height = 4;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const index = pixel * 4;
    data[index] = 180;
    data[index + 1] = 180;
    data[index + 2] = 180;
    data[index + 3] = 255;
  }
  return { width, height, data };
}
