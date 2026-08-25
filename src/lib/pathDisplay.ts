export function displayWindowsPath(path: string): string {
  const upper = path.toUpperCase();
  if (upper.startsWith('\\\\?\\UNC\\')) return `\\\\${path.slice(8)}`;
  if (upper.startsWith('\\\\?\\')) return path.slice(4);
  return path;
}
