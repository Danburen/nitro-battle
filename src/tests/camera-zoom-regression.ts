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

test("the zoom-out floor keeps the viewport smaller than the toroidal map", () => {
    const camera = new Camera(2000, 1500);
    camera.fit(1800, 1500);
    near(camera.minZoom, 1500 / (1500 * 0.9));
    near(camera.zoom, camera.minZoom, 1e-9);
    assert.ok(1800 / camera.zoom <= 1800 + 1e-9, "viewport exceeds the map width");
    assert.ok(1500 / camera.zoom <= 1350 + 1e-9, "viewport exceeds 90% of the map height");
    // Zooming out can never reveal a periodic copy of the map.
    camera.zoomAt(900, 750, 0.01, 1800, 1500);
    near(camera.zoom, camera.minZoom);
    assert.ok(1800 / camera.zoom <= 1800 + 1e-9);
    assert.ok(1500 / camera.zoom <= 1350 + 1e-9);
});

test("the floor follows the window size while the ceiling keeps deep-map zoom", () => {
    const camera = new Camera(1800, 1100);
    camera.fit(1200, 800);
    // 800 / (1100 * 0.9) wins over the width constraint and the fit overview.
    near(camera.minZoom, 800 / 990);
    near(camera.zoom, camera.minZoom);
    near(camera.maxZoom, 1.6);
    camera.setViewport(2400, 1600);
    near(camera.minZoom, 1600 / 990);
    near(camera.zoom, camera.minZoom);
    near(camera.maxZoom, 2400 / 1100);
    // Growing or shrinking the window always pulls a stray zoom back into range.
    camera.zoom = 4;
    camera.setViewport(1400, 900);
    near(camera.zoom, 1.6);
    camera.zoom = 3;
    camera.setViewport(800, 600);
    near(camera.zoom, 1.6);
});

test("fit prefers the torus floor over a full overview on large windows", () => {
    const camera = new Camera(1400, 900);
    camera.fit(1000, 700);
    near(camera.minZoom, 700 / 810);
    near(camera.zoom, camera.minZoom);
    assert.ok(1000 / camera.zoom <= 1260 + 1e-9);
    assert.ok(700 / camera.zoom <= 810 + 1e-9);
    const square = new Camera(1000, 1000);
    square.fit(500, 500);
    near(square.zoom, 500 / 900);
    assert.ok(square.minZoom <= square.maxZoom);
});

test("a degenerate world size falls back to a finite ceiling", () => {
    const camera = new Camera(0, 0);
    assert.equal(camera.maxZoom, 1.6);
    camera.zoomAt(0, 0, 2, 0, 0);
    assert.equal(camera.zoom, 1.6);
    assert.ok(Number.isFinite(camera.zoom));
});
