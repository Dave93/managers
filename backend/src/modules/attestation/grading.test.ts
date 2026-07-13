import { describe, expect, it } from "bun:test";
import { gradeAnswer, gradeAttempt, pickQuestionIds, shuffleWithRng } from "./grading";

const single = { id: "q1", type: "single" as const, correctOptionIds: ["a"] };
const multi = { id: "q2", type: "multi" as const, correctOptionIds: ["a", "b"] };

describe("gradeAnswer", () => {
  it("single: correct when exact match", () => {
    expect(gradeAnswer(single, ["a"])).toBe(true);
  });
  it("single: wrong when different option", () => {
    expect(gradeAnswer(single, ["b"])).toBe(false);
  });
  it("multi: correct only when the set matches exactly", () => {
    expect(gradeAnswer(multi, ["b", "a"])).toBe(true);
    expect(gradeAnswer(multi, ["a"])).toBe(false);
    expect(gradeAnswer(multi, ["a", "b", "c"])).toBe(false);
  });
  it("empty selection is wrong", () => {
    expect(gradeAnswer(single, [])).toBe(false);
  });
});

describe("gradeAttempt", () => {
  it("scores percentage rounded", () => {
    const r = gradeAttempt([single, multi], { q1: ["a"], q2: ["a"] });
    expect(r.correctCount).toBe(1);
    expect(r.score).toBe(50);
  });
  it("missing answer counts wrong", () => {
    const r = gradeAttempt([single], {});
    expect(r.score).toBe(0);
  });
  it("empty test scores 0 without dividing by zero", () => {
    expect(gradeAttempt([], {}).score).toBe(0);
  });
});

describe("pickQuestionIds / shuffle", () => {
  const rng = () => 0; // deterministic
  it("returns all when n is null", () => {
    expect(pickQuestionIds(["a", "b", "c"], null, rng).sort()).toEqual(["a", "b", "c"]);
  });
  it("returns n items when n < length", () => {
    expect(pickQuestionIds(["a", "b", "c"], 2, rng)).toHaveLength(2);
  });
  it("shuffleWithRng does not mutate input", () => {
    const input = ["a", "b", "c"];
    shuffleWithRng(input, rng);
    expect(input).toEqual(["a", "b", "c"]);
  });
});
