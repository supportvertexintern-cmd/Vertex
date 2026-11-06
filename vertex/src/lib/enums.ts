import type { components } from "./api.generated";

// The enums the website works with, from FastAPI's own schema (generated
// from vertex_be/app/models/enums.py), so they can't drift from the backend.
export type Role = components["schemas"]["Role"];
export type ReportCycle = components["schemas"]["ReportCycle"];
export type CandidateSource = components["schemas"]["CandidateSource"];
