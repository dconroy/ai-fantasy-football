export function sourceFromBoard(source?: string | null): "chen" | "fantasypros" | "ffcalc" {
  const text = source ?? "";
  if (/fantasypros|ecr/i.test(text)) return "fantasypros";
  if (/calculator|ffcalc|adp/i.test(text)) return "ffcalc";
  return "chen";
}
