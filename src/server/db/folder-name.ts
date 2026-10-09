// Shared by the additive migration and every folder writer. Display spelling
// is preserved separately; accents and internal whitespace remain significant.
export function folderNameKey(value: string): string {
  return value.trim().normalize('NFC').toLowerCase();
}
