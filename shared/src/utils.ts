export function createIdFactory(...prefixParts: Array<string | number>) {
  let counter = 0;
  const prefix = prefixParts
    .filter((part) => part !== undefined && part !== null && `${part}`.length > 0)
    .map((part) => `${part}`)
    .join('-');
  const formatted = prefix.length > 0 ? `${prefix}-` : '';
  return () => `${formatted}${counter++}`;
}

export const sumHp = (list: { hp?: number }[]) =>
  list.reduce((total, item) => total + (Number(item?.hp) || 0), 0);
