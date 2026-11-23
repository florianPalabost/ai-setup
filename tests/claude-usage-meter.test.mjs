import assert from "node:assert/strict";
import { test } from "node:test";
import { meterParts } from "../herdr/mods/claude-usage/meter.js";

const NOW = 1_800_000_000;
const HOUR = 3600;
const DAY = 86400;

test("each limit shows its used percent and the time left to its reset", () => {
  // Arrange
  const saved = {
    five_hour: { used_percentage: 42.4, resets_at: NOW + 2 * HOUR + 10 * 60 },
    seven_day: { used_percentage: 18, resets_at: NOW + 3 * DAY + 4 * HOUR },
  };

  // Act
  const parts = meterParts(saved, NOW);

  // Assert
  assert.deepEqual(parts, [
    { label: "5h", percent: "42%", tone: "low", resets: "2h 10m" },
    { label: "7d", percent: "18%", tone: "low", resets: "3d 4h" },
  ]);
});

test("a limit at 50% or more is mid, at 80% or more is high", () => {
  // Arrange
  const saved = {
    five_hour: { used_percentage: 80, resets_at: NOW + 30 * 60 },
    seven_day: { used_percentage: 50, resets_at: NOW + DAY },
  };

  // Act
  const tones = meterParts(saved, NOW).map((part) => part.tone);

  // Assert
  assert.deepEqual(tones, ["high", "mid"]);
});

test("a reset under an hour away shows minutes only", () => {
  // Arrange
  const saved = { five_hour: { used_percentage: 10, resets_at: NOW + 59 } };

  // Act
  const [part] = meterParts(saved, NOW);

  // Assert
  assert.equal(part.resets, "1m");
});

test("a limit past its reset shows 0% and no reset time", () => {
  // Arrange
  const saved = { five_hour: { used_percentage: 91, resets_at: NOW - 1 } };

  // Act
  const parts = meterParts(saved, NOW);

  // Assert
  assert.deepEqual(parts, [{ label: "5h", percent: "0%", tone: "low", resets: null }]);
});

test("no saved limits show nothing", () => {
  // Act
  const parts = [meterParts(null, NOW), meterParts({}, NOW)];

  // Assert
  assert.deepEqual(parts, [[], []]);
});
