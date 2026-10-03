import { describe, expect, test } from "bun:test";
import {
  levelAfterMaterialOpened, levelAfterQuizPassed, canObserve,
  levelAfterObserved, levelAfterRecheckFailed, observationComplete, hasQuiz,
} from "./state";

describe("passport level state machine", () => {
  test("material opened: 0 -> 1, never lowers", () => {
    expect(levelAfterMaterialOpened(0)).toBe(1);
    expect(levelAfterMaterialOpened(3)).toBe(3);
  });
  test("quiz passed with observation type -> 2", () => {
    expect(levelAfterQuizPassed(1, "quiz_observation")).toBe(2);
  });
  test("quiz passed on quiz-only topic -> 3", () => {
    expect(levelAfterQuizPassed(1, "quiz")).toBe(3);
  });
  test("observe allowed from 2 when quiz required, from 1 when not", () => {
    expect(canObserve(1, "quiz_observation")).toBe(false);
    expect(canObserve(2, "quiz_observation")).toBe(true);
    expect(canObserve(1, "observation")).toBe(true);
  });
  test("observed -> 3; recheck fail -> 2", () => {
    expect(levelAfterObserved(2)).toBe(3);
    expect(levelAfterRecheckFailed()).toBe(2);
  });
  test("observationComplete requires every tick", () => {
    const cl = { items: [{}, {}], questions: [{}] };
    expect(observationComplete(cl, { items: [true, true], questions: [true] })).toBe(true);
    expect(observationComplete(cl, { items: [true, false], questions: [true] })).toBe(false);
    expect(observationComplete(cl, { items: [true], questions: [true] })).toBe(false);
  });
  test("hasQuiz mapping", () => {
    expect(hasQuiz("observation")).toBe(false);
    expect(hasQuiz("dual")).toBe(true);
  });
});
