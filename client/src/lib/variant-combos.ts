export interface ComboAttribute {
  name: string;
  values: string[];
}

export function cartesianProduct(attrs: ComboAttribute[]): Record<string, string>[] {
  const valid = attrs.filter((a) => a.name.trim() && a.values.length > 0);
  if (valid.length === 0) return [];
  return valid.reduce<Record<string, string>[]>((acc, attr) => {
    if (acc.length === 0) return attr.values.map((v) => ({ [attr.name]: v }));
    return acc.flatMap((combo) => attr.values.map((v) => ({ ...combo, [attr.name]: v })));
  }, []);
}

export function comboKey(dims: Record<string, string>): string {
  return Object.entries(dims)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}:${v}`)
    .join("|");
}

export function comboLabel(dims: Record<string, string>): string {
  return Object.values(dims).join(" / ");
}
