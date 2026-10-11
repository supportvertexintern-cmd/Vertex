// The industry-standard antivirus test file, decoded at runtime so the
// literal never sits in the repository (where a desktop antivirus would
// quarantine the file). Every scanner reports it as infected; it does
// nothing.
export const EICAR = Buffer.from(
  "WDVPIVAlQEFQWzRcUFpYNTQoUF4pN0NDKTd9JEVJQ0FSLVNUQU5EQVJELUFOVElWSVJVUy1URVNULUZJTEUhJEgrSCo=",
  "base64",
);
