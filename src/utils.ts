export function parseBoolean(input: string | undefined): boolean {
  if (!input) return false;
  return ["1", "true", "t", "yes", "y", "on"].includes(input.toLowerCase());
}

export function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}
