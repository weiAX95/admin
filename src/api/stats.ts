import type { Stats, StatsQuery } from "../types";
import { http } from "./client";

export const getStats = (query?: StatsQuery) => http.get<Stats>("/stats", query as Record<string, string | undefined>);