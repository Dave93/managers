import { expect, it } from "bun:test";
import { reasonCounter } from "../src/counter";

// Счётчик шторки спора. Считает буквы и цифры, как сервер (commentOk): пробелы и знаки не в счёт.

it("короче минимума: сколько ещё нужно, а не «5 / 5»", () => {
  expect(reasonCounter("", 5, null, "ru")).toEqual({ text: "ещё 5", ok: false });
  expect(reasonCounter("ок!!", 5, null, "ru")).toEqual({ text: "ещё 3", ok: false });
  expect(reasonCounter("1234", 5, null, "ru")).toEqual({ text: "ещё 1", ok: false });
  expect(reasonCounter("ок!!", 5, null, "uz")).toEqual({ text: "yana 3 ta", ok: false });
});

it("минимум набран: настоящая длина, а не минимум", () => {
  expect(reasonCounter("12345", 5, null, "ru")).toEqual({ text: "5", ok: true });
  const sixty = "В".repeat(60);
  expect(reasonCounter(sixty, 5, null, "ru")).toEqual({ text: "60", ok: true });
  expect(reasonCounter(sixty, 5, null, "uz")).toEqual({ text: "60", ok: true });
});

it("считаются буквы и цифры, как у сервера: пробелы и знаки — нет", () => {
  expect(reasonCounter("  а б, в! 1 ", 5, null, "ru")).toEqual({ text: "ещё 1", ok: false });
  expect(reasonCounter("абв гд — е", 5, null, "ru")).toEqual({ text: "6", ok: true });
});

it("максимум, если он есть: «длина / максимум»", () => {
  expect(reasonCounter("12345678", 5, 500, "ru")).toEqual({ text: "8 / 500", ok: true });
  // ниже минимума максимум не показываем: сейчас важнее, сколько осталось
  expect(reasonCounter("12", 5, 500, "ru")).toEqual({ text: "ещё 3", ok: false });
});
