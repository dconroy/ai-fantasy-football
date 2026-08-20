export function sourceFromBoard(
  source?: string | null,
): "chen" | "fantasypros" | "sleeper" | "ffcalc" {
  const text = source ?? "";
  if (/fantasypros|ecr/i.test(text)) return "fantasypros";
  if (/sleeper/i.test(text)) return "sleeper";
  if (/calculator|ffcalc|adp/i.test(text)) return "ffcalc";
  return "chen";
}
