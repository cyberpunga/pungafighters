import { describe, expect, it } from "vitest";
import { createFrameCollisionMetadata } from "./collisionMetadata";

describe("collision metadata", () => {
  it("falls back safely for a transparent frame", () => {
    const collision = createFrameCollisionMetadata(createImageData(), "idle");

    expect(collision.source).toBe("alpha-v1");
    expect(collision.hurtboxes).toHaveLength(1);
    expect(collision.hurtboxes[0].width).toBeGreaterThan(0);
  });

  it("builds a hurtbox from visible body alpha", () => {
    const imageData = createImageData();
    fillRect(imageData, 140, 96, 92, 190);

    const collision = createFrameCollisionMetadata(imageData, "idle");

    expect(collision.hurtboxes[0]).toMatchObject({
      x: 132,
      y: 90,
      width: 108,
      height: 202,
    });
  });

  it("derives an upper forward punch attack box", () => {
    const imageData = createImageData();
    fillRect(imageData, 140, 96, 92, 190);
    fillRect(imageData, 224, 132, 82, 28);

    const collision = createFrameCollisionMetadata(imageData, "punch");

    expect(collision.attackBoxes).toHaveLength(1);
    expect(collision.attackBoxes?.[0].x).toBeGreaterThan(210);
    expect(collision.attackBoxes?.[0].y).toBeLessThan(150);
    expect(collision.attackBoxes?.[0].height).toBeLessThan(50);
  });

  it("derives a lower forward kick attack box", () => {
    const imageData = createImageData();
    fillRect(imageData, 140, 96, 92, 190);
    fillRect(imageData, 218, 236, 96, 34);

    const collision = createFrameCollisionMetadata(imageData, "kick");

    expect(collision.attackBoxes).toHaveLength(1);
    expect(collision.attackBoxes?.[0].x).toBeGreaterThan(208);
    expect(collision.attackBoxes?.[0].y).toBeGreaterThan(220);
  });

  it("ignores tiny noisy alpha islands", () => {
    const imageData = createImageData();
    fillRect(imageData, 300, 40, 3, 3);

    const collision = createFrameCollisionMetadata(imageData, "punch");

    expect(collision.hurtboxes[0]).toMatchObject({ x: 132, y: 92, width: 118, height: 190 });
    expect(collision.attackBoxes?.[0]).toMatchObject({ x: 238, y: 120, width: 76, height: 58 });
  });
});

function createImageData(width = 384, height = 384) {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

function fillRect(imageData: ReturnType<typeof createImageData>, x: number, y: number, width: number, height: number) {
  for (let row = y; row < y + height; row += 1) {
    for (let col = x; col < x + width; col += 1) {
      const index = (row * imageData.width + col) * 4;
      imageData.data[index] = 255;
      imageData.data[index + 1] = 255;
      imageData.data[index + 2] = 255;
      imageData.data[index + 3] = 255;
    }
  }
}
