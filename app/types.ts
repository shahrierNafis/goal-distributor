export interface GoalHistoryEntry {
  id: string;
  periodStart: string; // Formatted date string
  periodEnd: string;
  repsCompleted: number;
  totalReps: number;
  status: "COMPLETED" | "PARTIAL" | "FAILED";
  timestamp: number;
}

export type TimespanType = "daily" | "multi-day" | "weekly" | "monthly" | "yearly";

export interface Goal {
  id: string;
  name: string;
  totalReps: number;
  currentReps: number;
  timespan: TimespanType;

  // daily specific
  startTime?: string; // e.g. "00:00"
  endTime?: string; // e.g. "12:00"

  // multi-day / weekly / monthly / yearly specific
  durationValue?: number; // e.g. number of days/weeks/months/years

  frequency: number; // default 60 (1 hour)
  createdAt: number;

  // Tracking intervals (timestamps in ms)
  currentPeriodStart: number;
  currentPeriodEnd: number;

  history: GoalHistoryEntry[];
}
