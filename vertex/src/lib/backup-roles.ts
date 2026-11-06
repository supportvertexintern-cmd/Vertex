import type { Role } from "@/lib/enums";

// Who may use the backup export (its catalogue, record picker and ZIP). The
// same list as vertex_be/app/services/backup.py's BACKUP_ROLES, which
// decides; the website's routes refuse anyone else early.
export const BACKUP_ROLES: Role[] = ["admin", "director", "operations_team", "operations_director", "hr", "finance"];
