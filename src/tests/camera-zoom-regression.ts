import assert from "node:assert/strict";
import test from "node:test";
import { Camera } from "../render/index.ts";

const near = (actual: number, expected: number, epsilon = 1e-9): void => {
    assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`);
};

test("zoom-in ceiling keeps the visible strip at least as wide as the map's short side", () => {
    const camera = new Camera(1400, 900);
    camera.fit(1600, 900);
    const ceiling = 1600 / 900;
    near(camera.maxZoom, ceiling);
    camera.zoomAt(800, 450, 40, 1600, 900);
    near(camera.zoom, ceiling);
    // One more wheel tick cannot push past the ceiling.
    camera.zoomAt(800, 450, 4, 1600, 900);
    near(camera.zoom, ceiling);
    assert.ok(1600 / camera.zoom >= 900 - 1e-9, "visible world strip is narrower than the map short side");
});

test("the ceiling follows the window size and never drops below deep-map zoom", () => {
    const camera = new Camera(1800, 1100);
    camera.fit(1200, 800);
    // 1200 / 1100 < 1.6, so the usability floor wins instead of blocking province counters.
    near(camera.maxZoom, 1.6);
    camera.setViewport(2400, 1600);
    near(camera.maxZoom, 2400 / 1100);
    // Growing the window does not silently keep an out-of-range zoom.
    camera.zoom = 4;
    camera.setViewport(1400, 900);
    near(camera.zoom, 1.6);
    camera.zoom = 3;
    camera.setViewport(800, 600);
    near(camera.zoom, 1.6);
});

test("fit still shows the whole map and never exceeds its own ceiling", () => {
    const camera = new Camera(1400, 900);
    camera.fit(1000, 700);
    near(camera.zoom, Math.min(1000 / 1400, 700 / 900) * 0.98);
    near(camera.minZoom, camera.zoom * 0.6);
    const square = new Camera(1000, 1000);
    square.fit(500, 500);
    near(square.zoom, 0.49);
    assert.ok(square.maxZoom >= square.zoom);
});

test("a degenerate world size falls back to a finite ceiling", () => {
    const camera = new Camera(0, 0);
    assert.equal(camera.maxZoom, 1.6);
    camera.zoomAt(0, 0, 2, 0, 0);
    assert.ok(Number.isFinite(camera.zoom));
});
