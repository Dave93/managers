export type TicketStatus = "new" | "in_progress" | "done" | "closed" | "cancelled";
export type TicketAction = "claim" | "submit" | "accept" | "reopen" | "cancel";

// Единственное место, где записан жизненный цикл заявки. И контроллер, и
// мини-апп спрашивают тут, а не повторяют условия у себя: расхождение между
// двумя копиями правил проявляется как "кнопка есть, а нажать нельзя".
const TRANSITIONS: Record<TicketAction, { from: TicketStatus[]; to: TicketStatus }> = {
  claim: { from: ["new"], to: "in_progress" },
  submit: { from: ["in_progress"], to: "done" },
  accept: { from: ["done"], to: "closed" },
  reopen: { from: ["done"], to: "in_progress" },
  cancel: { from: ["new", "in_progress"], to: "cancelled" },
};

export function nextStatus(action: TicketAction, from: TicketStatus): TicketStatus | null {
  const rule = TRANSITIONS[action];
  if (!rule) return null;
  return rule.from.includes(from) ? rule.to : null;
}

export function allowedActions(from: TicketStatus): TicketAction[] {
  return (Object.keys(TRANSITIONS) as TicketAction[]).filter((a) => nextStatus(a, from) !== null);
}

export function allowedFrom(action: TicketAction): TicketStatus[] {
  return [...(TRANSITIONS[action]?.from ?? [])];
}
