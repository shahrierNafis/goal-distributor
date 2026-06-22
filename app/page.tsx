"use client";

import { useState, useEffect } from "react";
import {
  Target,
  Plus,
  Trash2,
  Clock,
  Activity,
  CheckCircle,
  AlertCircle,
  Sparkles,
  Info,
  Calendar,
  ChevronDown,
  ChevronUp,
  History,
  Edit2,
  X,
} from "lucide-react";
import { Goal, GoalHistoryEntry, TimespanType } from "./types";

// Helper to convert "HH:MM" to seconds from midnight
const timeToSeconds = (timeStr: string): number => {
  const [hours, minutes] = timeStr.split(":").map(Number);
  return hours * 3600 + minutes * 60;
};

// Helper to format "HH:MM" 24h to 12h AM/PM
const format12Hour = (timeStr: string): string => {
  if (!timeStr) return "";
  const [hoursStr, minutesStr] = timeStr.split(":");
  const hours = parseInt(hoursStr, 10);
  const ampm = hours >= 12 ? "PM" : "AM";
  const displayHours = hours % 12 === 0 ? 12 : hours % 12;
  return `${displayHours}:${minutesStr} ${ampm}`;
};

// Helper to format date-time for history log
const formatTimestamp = (ts: number): string => {
  return new Date(ts).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

// Helper to format duration in seconds into d, h, m, s
const formatTimeSeconds = (secs: number): string => {
  const days = Math.floor(secs / 86400);
  const hours = Math.floor((secs % 86400) / 3600);
  const minutes = Math.floor((secs % 3600) / 60);
  const seconds = Math.floor(secs % 60);

  if (days > 0) {
    return `${days}d ${hours}h ${minutes}m ${seconds}s`;
  }
  return [
    hours.toString().padStart(2, "0"),
    minutes.toString().padStart(2, "0"),
    seconds.toString().padStart(2, "0"),
  ].join(":");
};

// Helper to compute initial start and end times for a goal
const getInitialPeriod = (
  timespan: TimespanType,
  durationValue: number,
  startTime: string,
  endTime: string,
  createdAt: number,
  now: Date,
): { start: number; end: number } => {
  if (timespan === "daily") {
    const startSec = timeToSeconds(startTime);
    const endSec = timeToSeconds(endTime);
    const nowSec = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();

    const startToday = new Date(now);
    const [sh, sm] = startTime.split(":").map(Number);
    startToday.setHours(sh, sm, 0, 0);

    const endToday = new Date(now);
    const [eh, em] = endTime.split(":").map(Number);
    endToday.setHours(eh, em, 0, 0);

    if (endSec < startSec) {
      // Cross-midnight: e.g. 10 PM - 2 AM
      if (nowSec >= startSec) {
        // e.g. 11 PM. Start today, end tomorrow
        const endTom = new Date(endToday);
        endTom.setDate(endTom.getDate() + 1);
        return { start: startToday.getTime(), end: endTom.getTime() };
      } else if (nowSec < endSec) {
        // e.g. 1 AM. Start yesterday, end today
        const startYes = new Date(startToday);
        startYes.setDate(startYes.getDate() - 1);
        return { start: startYes.getTime(), end: endToday.getTime() };
      } else {
        // e.g. 12 PM (noon). Inactive gap before start.
        // Upcoming window starts today at 10 PM and ends tomorrow at 2 AM
        const endTom = new Date(endToday);
        endTom.setDate(endTom.getDate() + 1);
        return { start: startToday.getTime(), end: endTom.getTime() };
      }
    } else if (endSec > startSec) {
      // Same-day: e.g. 9 AM - 5 PM
      if (nowSec >= endSec) {
        // Past the end time today. The next window starts tomorrow.
        const startTom = new Date(startToday);
        startTom.setDate(startTom.getDate() + 1);
        const endTom = new Date(endToday);
        endTom.setDate(endTom.getDate() + 1);
        return { start: startTom.getTime(), end: endTom.getTime() };
      } else {
        // Before start or during window today. Starts/ends today.
        return { start: startToday.getTime(), end: endToday.getTime() };
      }
    } else {
      // 24 hour window
      if (nowSec >= startSec) {
        const endTom = new Date(endToday);
        endTom.setDate(endTom.getDate() + 1);
        return { start: startToday.getTime(), end: endTom.getTime() };
      } else {
        const startYes = new Date(startToday);
        startYes.setDate(startYes.getDate() - 1);
        return { start: startYes.getTime(), end: endToday.getTime() };
      }
    }
  }

  // Non-daily timespans start at createdAt
  const start = createdAt;
  let end = start;

  if (timespan === "multi-day") {
    end = start + durationValue * 24 * 3600 * 1000;
  } else if (timespan === "weekly") {
    end = start + durationValue * 7 * 24 * 3600 * 1000;
  } else if (timespan === "monthly") {
    const d = new Date(start);
    d.setMonth(d.getMonth() + durationValue);
    end = d.getTime();
  } else if (timespan === "yearly") {
    const d = new Date(start);
    d.setFullYear(d.getFullYear() + durationValue);
    end = d.getTime();
  }

  return { start, end };
};

// Helper function to check all goals for expiration and reset them
const checkAndResetGoals = (goalsList: Goal[], now: Date): { updated: boolean; goals: Goal[] } => {
  let changed = false;
  const nowMs = now.getTime();

  const updatedGoals = goalsList.map((goal) => {
    if (nowMs <= goal.currentPeriodEnd) {
      return goal;
    }

    changed = true;
    const updatedGoal = { ...goal };
    const historyToAdd: GoalHistoryEntry[] = [];

    while (nowMs > updatedGoal.currentPeriodEnd) {
      // Archive current reps for the first missed period, 0 for any subsequent ones
      const repsCompleted = historyToAdd.length === 0 ? updatedGoal.currentReps : 0;
      const status: "COMPLETED" | "PARTIAL" | "FAILED" =
        repsCompleted >= updatedGoal.totalReps ? "COMPLETED" : repsCompleted > 0 ? "PARTIAL" : "FAILED";

      const entry: GoalHistoryEntry = {
        id: crypto.randomUUID(),
        periodStart: formatTimestamp(updatedGoal.currentPeriodStart),
        periodEnd: formatTimestamp(updatedGoal.currentPeriodEnd),
        repsCompleted,
        totalReps: updatedGoal.totalReps,
        status,
        timestamp: updatedGoal.currentPeriodEnd,
      };

      historyToAdd.push(entry);

      // Advance period bounds
      const nextStart = updatedGoal.currentPeriodEnd;
      let nextEnd = nextStart;
      const val = updatedGoal.durationValue || 1;

      if (updatedGoal.timespan === "daily") {
        nextEnd = nextStart + 24 * 3600 * 1000;
      } else if (updatedGoal.timespan === "multi-day") {
        nextEnd = nextStart + val * 24 * 3600 * 1000;
      } else if (updatedGoal.timespan === "weekly") {
        nextEnd = nextStart + val * 7 * 24 * 3600 * 1000;
      } else if (updatedGoal.timespan === "monthly") {
        const d = new Date(nextStart);
        d.setMonth(d.getMonth() + val);
        nextEnd = d.getTime();
      } else if (updatedGoal.timespan === "yearly") {
        const d = new Date(nextStart);
        d.setFullYear(d.getFullYear() + val);
        nextEnd = d.getTime();
      }

      updatedGoal.currentPeriodStart = nextStart;
      updatedGoal.currentPeriodEnd = nextEnd;
      updatedGoal.currentReps = 0; // reset reps for next period
    }

    updatedGoal.history = [...historyToAdd, ...updatedGoal.history]; // prepend new history
    return updatedGoal;
  });

  return { updated: changed, goals: updatedGoals };
};

export default function Dashboard() {
  const [isMounted, setIsMounted] = useState(false);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [currentTime, setCurrentTime] = useState<Date>(new Date());

  // Tab filtering: "all" | "active" | "pending" | "completed"
  const [filterTab, setFilterTab] = useState<"all" | "active" | "pending" | "completed">("all");

  // Tracks which goal cards have their history drawer open
  const [expandedHistory, setExpandedHistory] = useState<Record<string, boolean>>({});

  // Form states (Add goal)
  const [goalName, setGoalName] = useState("");
  const [totalReps, setTotalReps] = useState<number>(10);
  const [timespan, setTimespan] = useState<TimespanType>("daily");
  const [durationValue, setDurationValue] = useState<number>(1);

  // Daily specific times
  const [startTime, setStartTime] = useState("00:00");
  const [endTime, setEndTime] = useState("16:00");

  // Frequency settings
  const [frequency, setFrequency] = useState<number>(60);
  const [formError, setFormError] = useState("");

  // Edit Goal state
  const [editingGoalId, setEditingGoalId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editTotalReps, setEditTotalReps] = useState<number>(10);
  const [editStartTime, setEditStartTime] = useState("00:00");
  const [editEndTime, setEditEndTime] = useState("16:00");
  const [editDurationValue, setEditDurationValue] = useState<number>(1);

  // Handle client-side mounting & catch-up resets on load
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsMounted(true);
    const savedGoals = localStorage.getItem("goals_distributor_data");
    if (savedGoals) {
      try {
        const parsed = JSON.parse(savedGoals) as Goal[];
        const now = new Date();
        const { updated, goals: newGoals } = checkAndResetGoals(parsed, now);
        if (updated) {
          setGoals(newGoals);
          localStorage.setItem("goals_distributor_data", JSON.stringify(newGoals));
        } else {
          setGoals(parsed);
        }
      } catch (e) {
        console.error("Error loading goals from localStorage", e);
      }
    }
  }, []);

  // Update time every second and check for dynamic resets
  useEffect(() => {
    const timer = setInterval(() => {
      const now = new Date();
      setCurrentTime(now);

      setGoals((currentGoals) => {
        const { updated, goals: newGoals } = checkAndResetGoals(currentGoals, now);
        if (updated) {
          localStorage.setItem("goals_distributor_data", JSON.stringify(newGoals));
          return newGoals;
        }
        return currentGoals;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Sync goals helper
  const saveGoals = (updatedGoals: Goal[]) => {
    setGoals(updatedGoals);
    localStorage.setItem("goals_distributor_data", JSON.stringify(updatedGoals));
  };

  // Add Goal Handler
  const handleAddGoal = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError("");

    if (!goalName.trim()) {
      setFormError("Goal name is required");
      return;
    }

    if (totalReps <= 0) {
      setFormError("Total reps must be greater than 0");
      return;
    }

    if (timespan !== "daily" && (isNaN(durationValue) || durationValue <= 0)) {
      setFormError("Duration must be a positive number");
      return;
    }

    const freqMinutes = frequency;
    if (isNaN(freqMinutes) || freqMinutes <= 0) {
      setFormError("Frequency must be greater than 0 minutes");
      return;
    }

    const createdAtTimestamp = Date.now();
    const period = getInitialPeriod(timespan, durationValue, startTime, endTime, createdAtTimestamp, currentTime);

    const newGoal: Goal = {
      id: crypto.randomUUID(),
      name: goalName.trim(),
      totalReps,
      currentReps: 0,
      timespan,
      startTime: timespan === "daily" ? startTime : undefined,
      endTime: timespan === "daily" ? endTime : undefined,
      durationValue: timespan !== "daily" ? durationValue : undefined,
      frequency: freqMinutes,
      createdAt: createdAtTimestamp,
      currentPeriodStart: period.start,
      currentPeriodEnd: period.end,
      history: [],
    };

    const updatedGoals = [newGoal, ...goals];
    saveGoals(updatedGoals);

    // Reset fields
    setGoalName("");
    setTotalReps(10);
    setTimespan("daily");
    setDurationValue(1);
    setStartTime("00:00");
    setEndTime("16:00");
    setFrequency(60);
  };

  // Start Editing Handler
  const handleStartEdit = (goal: Goal) => {
    setEditingGoalId(goal.id);
    setEditName(goal.name);
    setEditTotalReps(goal.totalReps);
    setEditStartTime(goal.startTime || "00:00");
    setEditEndTime(goal.endTime || "16:00");
    setEditDurationValue(goal.durationValue || 1);
  };

  // Save Edit Handler
  const handleSaveEdit = (e: React.FormEvent, id: string) => {
    e.preventDefault();

    if (!editName.trim()) {
      alert("Goal name is required");
      return;
    }

    if (editTotalReps <= 0) {
      alert("Total reps must be greater than 0");
      return;
    }

    const updatedGoals = goals.map((goal) => {
      if (goal.id !== id) return goal;

      const updatedGoal = {
        ...goal,
        name: editName.trim(),
        totalReps: editTotalReps,
        currentReps: Math.min(editTotalReps, goal.currentReps), // clamp reps completed
      };

      if (goal.timespan === "daily") {
        updatedGoal.startTime = editStartTime;
        updatedGoal.endTime = editEndTime;

        // Recalculate working boundaries relative to today
        const period = getInitialPeriod("daily", 1, editStartTime, editEndTime, goal.createdAt, currentTime);
        updatedGoal.currentPeriodStart = period.start;
        updatedGoal.currentPeriodEnd = period.end;
      } else {
        updatedGoal.durationValue = editDurationValue;

        // Recalculate end timestamp from the currentPeriodStart
        const start = goal.currentPeriodStart;
        let end = start;
        const val = editDurationValue;

        if (goal.timespan === "multi-day") {
          end = start + val * 24 * 3600 * 1000;
        } else if (goal.timespan === "weekly") {
          end = start + val * 7 * 24 * 3600 * 1000;
        } else if (goal.timespan === "monthly") {
          const d = new Date(start);
          d.setMonth(d.getMonth() + val);
          end = d.getTime();
        } else if (goal.timespan === "yearly") {
          const d = new Date(start);
          d.setFullYear(d.getFullYear() + val);
          end = d.getTime();
        }

        updatedGoal.currentPeriodEnd = end;
      }

      return updatedGoal;
    });

    // Check if the modified time makes the goal expired right away
    const { goals: finalizedGoals } = checkAndResetGoals(updatedGoals, currentTime);
    saveGoals(finalizedGoals);
    setEditingGoalId(null);
  };

  // Delete Goal
  const handleDeleteGoal = (id: string) => {
    const updatedGoals = goals.filter((g) => g.id !== id);
    saveGoals(updatedGoals);
  };

  // Increment/Decrement Reps
  const handleIncrement = (id: string, by?: number) => {
    const updatedGoals = goals.map((g) => {
      if (g.id === id) {
        const nextReps = Math.min(g.totalReps, g.currentReps + (by || 1));
        return { ...g, currentReps: nextReps };
      }
      return g;
    });
    saveGoals(updatedGoals);
  };

  const handleDecrement = (id: string) => {
    const updatedGoals = goals.map((g) => {
      if (g.id === id) {
        const nextReps = Math.max(0, g.currentReps - 1);
        return { ...g, currentReps: nextReps };
      }
      return g;
    });
    saveGoals(updatedGoals);
  };

  // Expand/Collapse History drawer
  const toggleHistory = (id: string) => {
    setExpandedHistory((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  // Calculate goal parameters relative to current time
  const getGoalDetails = (goal: Goal) => {
    const nowMs = currentTime.getTime();
    let status: "ACTIVE" | "PENDING" | "ENDED" = "ACTIVE";
    let timeLeftSeconds = 0;
    let timeUntilStartSeconds = 0;

    if (nowMs < goal.currentPeriodStart) {
      status = "PENDING";
      timeLeftSeconds = (goal.currentPeriodEnd - goal.currentPeriodStart) / 1000;
      timeUntilStartSeconds = (goal.currentPeriodStart - nowMs) / 1000;
    } else if (nowMs <= goal.currentPeriodEnd) {
      status = "ACTIVE";
      timeLeftSeconds = (goal.currentPeriodEnd - nowMs) / 1000;
      timeUntilStartSeconds = 0;
    } else {
      status = "ENDED";
      timeLeftSeconds = 0;
      timeUntilStartSeconds = 0;
    }

    const repsLeft = Math.max(0, goal.totalReps - goal.currentReps);
    const isCompleted = repsLeft === 0;

    let pace = 0;
    if (timeLeftSeconds > 0 && repsLeft > 0) {
      pace = (goal.frequency * 60 * repsLeft) / timeLeftSeconds;
    }

    return {
      status,
      timeLeftSeconds,
      timeUntilStartSeconds,
      repsLeft,
      isCompleted,
      pace,
    };
  };

  // Format pace representation text
  const formatPaceText = (pace: number, freqMinutes: number) => {
    const formattedPace = pace.toFixed(1).replace(/\.0$/, "");
    if (freqMinutes === 60) return `${formattedPace} reps / hour`;
    if (freqMinutes === 1440) return `${formattedPace} reps / day`;
    if (freqMinutes === 1) return `${formattedPace} reps / min`;
    return `${formattedPace} reps / ${freqMinutes} mins`;
  };

  // Label for duration inputs
  const getDurationUnitLabel = (type: TimespanType) => {
    switch (type) {
      case "multi-day":
        return "Number of Days";
      case "weekly":
        return "Number of Weeks";
      case "monthly":
        return "Number of Months";
      case "yearly":
        return "Number of Years";
      default:
        return "";
    }
  };

  // Human description of timespan
  const getTimespanDescription = (goal: Goal) => {
    if (goal.timespan === "daily") {
      return `Daily (${format12Hour(goal.startTime || "")} - ${format12Hour(goal.endTime || "")})`;
    }
    const val = goal.durationValue || 1;
    const unit =
      goal.timespan === "multi-day"
        ? val === 1
          ? "Day"
          : "Days"
        : goal.timespan === "weekly"
          ? val === 1
            ? "Week"
            : "Weeks"
          : goal.timespan === "monthly"
            ? val === 1
              ? "Month"
              : "Months"
            : val === 1
              ? "Year"
              : "Years";

    return `${val} ${unit} timespan`;
  };

  if (!isMounted) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50 dark:bg-zinc-950">
        <div className="flex flex-col items-center gap-4">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent"></div>
          <p className="text-sm font-medium text-zinc-500">Loading Distributor Dashboard...</p>
        </div>
      </div>
    );
  }

  // Filtered goals
  const filteredGoals = goals.filter((goal) => {
    const { status, isCompleted } = getGoalDetails(goal);
    if (filterTab === "active") return status === "ACTIVE" && !isCompleted;
    if (filterTab === "pending") return status === "PENDING";
    if (filterTab === "completed") return isCompleted || (status === "ENDED" && !isCompleted);
    return true; // "all"
  });

  const activeCount = goals.filter((g) => {
    const { status, isCompleted } = getGoalDetails(g);
    return status === "ACTIVE" && !isCompleted;
  }).length;

  const totalRepsCompleted = goals.reduce((acc, g) => acc + g.currentReps, 0);
  const totalRepsGoal = goals.reduce((acc, g) => acc + g.totalReps, 0);
  const overallProgressPercent = totalRepsGoal > 0 ? Math.round((totalRepsCompleted / totalRepsGoal) * 100) : 0;

  return (
    <div className="min-h-screen px-4 py-8 md:px-8">
      {/* Header Container */}
      <header className="mx-auto mb-8 max-w-6xl">
        <div className="flex flex-col justify-between gap-4 border-b border-zinc-200 pb-6 dark:border-zinc-800 sm:flex-row sm:items-center">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-600 text-white shadow-lg shadow-blue-500/20 dark:bg-blue-500">
              <Target className="h-6 w-6 animate-pulse" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">Goal Distributor</h1>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                Pace your repetitions dynamically across customizable durations.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 rounded-lg bg-white px-4 py-2 shadow-xs border border-zinc-200 dark:border-zinc-800 dark:bg-zinc-900">
            <Clock className="h-4 w-4 text-blue-500 animate-spin" style={{ animationDuration: "6s" }} />
            <span className="text-sm font-semibold tabular-nums text-zinc-700 dark:text-zinc-300">
              {currentTime.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl">
        {/* Stats Grid */}
        <section className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-xs dark:border-zinc-800 dark:bg-zinc-900 transition-all hover:shadow-md">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-zinc-500 dark:text-zinc-400">Active Goals</span>
              <Activity className="h-5 w-5 text-emerald-500" />
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-3xl font-extrabold text-zinc-900 dark:text-zinc-50">{activeCount}</span>
              <span className="text-xs text-zinc-400">currently active</span>
            </div>
          </div>

          <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-xs dark:border-zinc-800 dark:bg-zinc-900 transition-all hover:shadow-md">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-zinc-500 dark:text-zinc-400">Total Repetitions</span>
              <CheckCircle className="h-5 w-5 text-blue-500" />
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-3xl font-extrabold text-zinc-900 dark:text-zinc-50">
                {totalRepsCompleted} <span className="text-lg font-medium text-zinc-400">/ {totalRepsGoal}</span>
              </span>
              <span className="text-xs text-zinc-400">({overallProgressPercent}%)</span>
            </div>
            <div className="mt-3 h-1.5 w-full rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
              <div
                className="h-full bg-blue-600 dark:bg-blue-500 transition-all duration-500"
                style={{ width: `${overallProgressPercent}%` }}
              ></div>
            </div>
          </div>

          <div className="sm:col-span-2 lg:col-span-1 rounded-xl border border-zinc-200 bg-white p-5 shadow-xs dark:border-zinc-800 dark:bg-zinc-900 transition-all hover:shadow-md flex flex-col justify-between">
            <div className="flex items-center gap-2 text-zinc-500 dark:text-zinc-400">
              <Info className="h-5 w-5 text-amber-500 shrink-0" />
              <span className="text-sm font-medium">Goal Customization & Editing</span>
            </div>
            <p className="mt-2 text-xs leading-normal text-zinc-600 dark:text-zinc-400">
              Click the edit icon on any goal card to modify its details, adjust required repetitions, start/end hours,
              or extend/shrink timespans.
            </p>
          </div>
        </section>

        {/* Dashboard Grid */}
        <div className="grid gap-8 lg:grid-cols-3">
          {/* Form Panel */}
          <div className="lg:col-span-1">
            <div className="sticky top-6 rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
              <div className="flex items-center gap-2 border-b border-zinc-100 pb-4 dark:border-zinc-800">
                <Plus className="h-5 w-5 text-blue-600 dark:text-blue-500" />
                <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-50">Add Goal</h2>
              </div>

              {formError && (
                <div className="mt-4 flex items-start gap-2 rounded-lg bg-red-50 p-3 text-xs text-red-800 dark:bg-red-950/30 dark:text-red-300 border border-red-200/50 dark:border-red-900/30">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>{formError}</span>
                </div>
              )}

              <form onSubmit={handleAddGoal} className="mt-4 space-y-4">
                {/* Goal Name */}
                <div>
                  <label
                    htmlFor="goalName"
                    className="block text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 mb-1.5"
                  >
                    Goal Name
                  </label>
                  <input
                    type="text"
                    id="goalName"
                    value={goalName}
                    onChange={(e) => setGoalName(e.target.value)}
                    placeholder="e.g. Work Commits, Study Hours"
                    className="w-full rounded-lg border border-zinc-300 bg-transparent px-3.5 py-2 text-sm text-zinc-900 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 dark:border-zinc-700 dark:text-zinc-100 dark:focus:border-blue-500 focus:outline-none"
                    maxLength={50}
                    required
                  />
                </div>

                {/* Total Reps */}
                <div>
                  <label
                    htmlFor="totalReps"
                    className="block text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 mb-1.5"
                  >
                    Total Target Reps
                  </label>
                  <input
                    type="number"
                    id="totalReps"
                    value={totalReps || ""}
                    onChange={(e) => setTotalReps(Math.max(1, parseInt(e.target.value, 10) || 0))}
                    min={1}
                    className="w-full rounded-lg border border-zinc-300 bg-transparent px-3.5 py-2 text-sm text-zinc-900 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 dark:border-zinc-700 dark:text-zinc-100 dark:focus:border-blue-500 focus:outline-none"
                    required
                  />
                </div>

                {/* Timespan Selector */}
                <div>
                  <label
                    htmlFor="timespan"
                    className="block text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 mb-1.5"
                  >
                    Timespan Type
                  </label>
                  <select
                    id="timespan"
                    value={timespan}
                    onChange={(e) => setTimespan(e.target.value as TimespanType)}
                    className="w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm text-zinc-900 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 dark:border-zinc-700 dark:text-zinc-100 dark:focus:border-blue-500 focus:outline-none"
                  >
                    <option value="daily" className="dark:bg-zinc-900">
                      Daily
                    </option>
                    <option value="multi-day" className="dark:bg-zinc-900">
                      Multi-Day
                    </option>
                    <option value="weekly" className="dark:bg-zinc-900">
                      Weekly
                    </option>
                    <option value="monthly" className="dark:bg-zinc-900">
                      Monthly
                    </option>
                    <option value="yearly" className="dark:bg-zinc-900">
                      Yearly
                    </option>
                  </select>
                </div>

                {/* Conditional Form Inputs */}
                {timespan === "daily" ? (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label
                        htmlFor="startTime"
                        className="block text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 mb-1.5"
                      >
                        Start Time
                      </label>
                      <input
                        type="time"
                        id="startTime"
                        value={startTime}
                        onChange={(e) => setStartTime(e.target.value)}
                        className="w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm text-zinc-900 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 dark:border-zinc-700 dark:text-zinc-100 dark:focus:border-blue-500 focus:outline-none"
                        required
                      />
                    </div>
                    <div>
                      <label
                        htmlFor="endTime"
                        className="block text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 mb-1.5"
                      >
                        End Time
                      </label>
                      <input
                        type="time"
                        id="endTime"
                        value={endTime}
                        onChange={(e) => setEndTime(e.target.value)}
                        className="w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm text-zinc-900 focus:border-blue-500 focus:ring-1 focus:ring-blue-555 dark:border-zinc-700 dark:text-zinc-100 dark:focus:border-blue-500 focus:outline-none"
                        required
                      />
                    </div>
                  </div>
                ) : (
                  <div>
                    <label
                      htmlFor="durationValue"
                      className="block text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 mb-1.5"
                    >
                      {getDurationUnitLabel(timespan)}
                    </label>
                    <input
                      type="number"
                      id="durationValue"
                      value={durationValue || ""}
                      onChange={(e) => setDurationValue(Math.max(1, parseInt(e.target.value, 10) || 0))}
                      min={1}
                      className="w-full rounded-lg border border-zinc-300 bg-transparent px-3.5 py-2 text-sm text-zinc-900 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 dark:border-zinc-700 dark:text-zinc-100 dark:focus:border-blue-500 focus:outline-none"
                      required
                    />
                  </div>
                )}

                {/* Pacing Frequency */}
                <div>
                  <label
                    htmlFor="freqType"
                    className="block text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 mb-1.5"
                  >
                    Required Pace Frequency
                  </label>
                  <select
                    id="freqType"
                    value={[15, 30, 60, 120, 240].includes(frequency) ? frequency.toString() : "custom"}
                    onChange={(e) =>
                      e.target.value === "custom"
                        ? setFrequency(
                            parseInt(prompt("Enter custom minutes:", frequency.toString()) ?? frequency.toString()),
                          )
                        : setFrequency(parseInt(e.target.value, 10))
                    }
                    className="w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm text-zinc-900 focus:border-blue-500 focus:ring-1 focus:ring-blue-555 dark:border-zinc-700 dark:text-zinc-100 dark:focus:border-blue-500 focus:outline-none"
                  >
                    <option value="15" className="dark:bg-zinc-900">
                      Every 15 minutes
                    </option>
                    <option value="30" className="dark:bg-zinc-900">
                      Every 30 minutes
                    </option>
                    <option value="60" className="dark:bg-zinc-900">
                      Every hour (Default)
                    </option>
                    <option value="120" className="dark:bg-zinc-900">
                      Every 2 hours
                    </option>
                    <option value="240" className="dark:bg-zinc-900">
                      Every 4 hours
                    </option>
                    <option value="custom" className="dark:bg-zinc-900">
                      {[15, 30, 60, 120, 240].includes(frequency) ? `Custom` : `Custom: Every ${frequency} minutes`}
                    </option>
                  </select>
                </div>
                <button
                  type="submit"
                  className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 active:bg-blue-800 dark:bg-blue-500 dark:hover:bg-blue-600 shadow-md shadow-blue-500/10 cursor-pointer"
                >
                  <Plus className="h-4 w-4" />
                  Add Goal
                </button>
              </form>
            </div>
          </div>

          {/* Goal List Panel */}
          <div className="lg:col-span-2">
            {/* Filter Tabs */}
            <div className="mb-6 flex border-b border-zinc-200 dark:border-zinc-800 overflow-x-auto gap-2">
              {[
                { id: "all", label: "All Goals", count: goals.length },
                { id: "active", label: "Active", count: activeCount },
                {
                  id: "pending",
                  label: "Pending",
                  count: goals.filter((g) => getGoalDetails(g).status === "PENDING").length,
                },
                {
                  id: "completed",
                  label: "Done & Closed",
                  count: goals.filter((g) => {
                    const { status, isCompleted } = getGoalDetails(g);
                    return isCompleted || status === "ENDED";
                  }).length,
                },
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setFilterTab(tab.id as typeof filterTab)}
                  className={`border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                    filterTab === tab.id
                      ? "border-blue-600 text-blue-600 dark:border-blue-500 dark:text-blue-500"
                      : "border-transparent text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100"
                  }`}
                >
                  {tab.label}
                  <span className="ml-1.5 rounded-full bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-655 dark:bg-zinc-800 dark:text-zinc-400">
                    {tab.count}
                  </span>
                </button>
              ))}
            </div>

            {/* List */}
            {filteredGoals.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-zinc-300 py-16 px-4 dark:border-zinc-800">
                <Target className="h-10 w-10 text-zinc-400 dark:text-zinc-600" />
                <h3 className="mt-4 text-sm font-semibold text-zinc-700 dark:text-zinc-300">No goals found</h3>
                <p className="mt-1 text-center text-xs text-zinc-500 dark:text-zinc-500 max-w-sm">
                  {filterTab === "all"
                    ? "Get started by adding your first goal in the left panel."
                    : `No goals found matching the "${filterTab}" filter.`}
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {filteredGoals.map((goal) => {
                  const isEditing = goal.id === editingGoalId;

                  if (isEditing) {
                    return (
                      <div
                        key={goal.id}
                        className="rounded-xl border border-blue-300 bg-blue-50/10 p-5 shadow-md dark:border-blue-800 dark:bg-zinc-900/90"
                      >
                        <form onSubmit={(e) => handleSaveEdit(e, goal.id)} className="space-y-4">
                          <div className="flex items-center justify-between border-b border-zinc-105 pb-2 dark:border-zinc-800">
                            <h4 className="text-sm font-bold text-zinc-900 dark:text-zinc-50 flex items-center gap-1.5">
                              <Edit2 className="h-4 w-4 text-blue-600 dark:text-blue-500" />
                              Edit Goal Details
                            </h4>
                            <button
                              type="button"
                              onClick={() => setEditingGoalId(null)}
                              className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 cursor-pointer"
                            >
                              <X className="h-4 w-4" />
                            </button>
                          </div>

                          <div>
                            <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-500 mb-1">
                              Goal Name
                            </label>
                            <input
                              type="text"
                              value={editName}
                              onChange={(e) => setEditName(e.target.value)}
                              className="w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-1.5 text-xs text-zinc-900 focus:outline-none focus:border-blue-500 dark:border-zinc-700 dark:text-zinc-100 focus:ring-1 focus:ring-blue-500"
                              maxLength={50}
                              required
                            />
                          </div>

                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-500 mb-1">
                                Target Reps
                              </label>
                              <input
                                type="number"
                                value={editTotalReps}
                                onChange={(e) => setEditTotalReps(Math.max(1, parseInt(e.target.value, 10) || 0))}
                                min={1}
                                className="w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-1.5 text-xs text-zinc-900 focus:outline-none focus:border-blue-500 dark:border-zinc-700 dark:text-zinc-100 focus:ring-1 focus:ring-blue-500"
                                required
                              />
                            </div>

                            {goal.timespan !== "daily" && (
                              <div>
                                <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-500 mb-1">
                                  {getDurationUnitLabel(goal.timespan)}
                                </label>
                                <input
                                  type="number"
                                  value={editDurationValue}
                                  onChange={(e) => setEditDurationValue(Math.max(1, parseInt(e.target.value, 10) || 0))}
                                  min={1}
                                  className="w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-1.5 text-xs text-zinc-900 focus:outline-none focus:border-blue-500 dark:border-zinc-700 dark:text-zinc-100 focus:ring-1 focus:ring-blue-500"
                                  required
                                />
                              </div>
                            )}
                          </div>

                          {goal.timespan === "daily" && (
                            <div className="grid grid-cols-2 gap-3">
                              <div>
                                <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-500 mb-1">
                                  Start Time
                                </label>
                                <input
                                  type="time"
                                  value={editStartTime}
                                  onChange={(e) => setEditStartTime(e.target.value)}
                                  className="w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-1.5 text-xs text-zinc-900 focus:outline-none focus:border-blue-500 dark:border-zinc-700 dark:text-zinc-100 focus:ring-1 focus:ring-blue-500"
                                  required
                                />
                              </div>
                              <div>
                                <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-500 mb-1">
                                  End Time
                                </label>
                                <input
                                  type="time"
                                  value={editEndTime}
                                  onChange={(e) => setEditEndTime(e.target.value)}
                                  className="w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-1.5 text-xs text-zinc-900 focus:outline-none focus:border-blue-500 dark:border-zinc-700 dark:text-zinc-100 focus:ring-1 focus:ring-blue-500"
                                  required
                                />
                              </div>
                            </div>
                          )}
                          <div>
                            <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-500 mb-1">
                              Required Pace Frequency
                            </label>
                            <input
                              type="number"
                              value={frequency}
                              onChange={(e) => setFrequency(parseInt(e.target.value, 10))}
                              className="w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-1.5 text-xs text-zinc-900 focus:outline-none focus:border-blue-500 dark:border-zinc-700 dark:text-zinc-100 focus:ring-1 focus:ring-blue-500"
                              maxLength={50}
                              required
                            />
                          </div>
                          <div className="flex gap-2 pt-2">
                            <button
                              type="submit"
                              className="flex-1 rounded-lg bg-blue-600 py-2 text-xs font-semibold text-white hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 transition-colors shadow-sm cursor-pointer"
                            >
                              Save Changes
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingGoalId(null)}
                              className="flex-1 rounded-lg border border-zinc-300 py-2 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-850 transition-colors cursor-pointer"
                            >
                              Cancel
                            </button>
                          </div>
                        </form>
                      </div>
                    );
                  }

                  const { status, timeLeftSeconds, timeUntilStartSeconds, repsLeft, isCompleted, pace } =
                    getGoalDetails(goal);

                  const progressPercent = Math.round((goal.currentReps / goal.totalReps) * 100);
                  const isHistoryOpen = !!expandedHistory[goal.id];

                  return (
                    <div
                      key={goal.id}
                      className={`relative overflow-hidden rounded-xl border p-5 shadow-xs transition-all duration-300 ${
                        isCompleted
                          ? "border-emerald-200 bg-emerald-50/20 dark:border-emerald-950/30 dark:bg-emerald-950/5"
                          : status === "ENDED"
                            ? "border-zinc-200 bg-zinc-50/50 dark:border-zinc-800/50 dark:bg-zinc-900/10"
                            : "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 hover:border-zinc-300 dark:hover:border-zinc-700"
                      }`}
                    >
                      {/* Top row */}
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <h3
                              className={`text-base font-bold ${
                                isCompleted
                                  ? "text-emerald-800 dark:text-emerald-400 line-through decoration-emerald-500/50"
                                  : status === "ENDED"
                                    ? "text-zinc-500 dark:text-zinc-500"
                                    : "text-zinc-900 dark:text-zinc-50"
                              }`}
                            >
                              {goal.name}
                            </h3>

                            {/* Badges */}
                            {isCompleted ? (
                              <span className="inline-flex items-center gap-1 rounded-md bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-400">
                                <Sparkles className="h-3 w-3 animate-spin" style={{ animationDuration: "4s" }} />
                                Completed
                              </span>
                            ) : status === "ACTIVE" ? (
                              <span className="inline-flex items-center gap-1 rounded-md bg-green-100 px-2 py-0.5 text-[10px] font-bold text-green-800 dark:bg-green-950/50 dark:text-green-400">
                                <span className="h-1.5 w-1.5 rounded-full bg-green-500 animate-ping"></span>
                                Active
                              </span>
                            ) : status === "PENDING" ? (
                              <span className="inline-flex items-center gap-1 rounded-md bg-blue-100 px-2 py-0.5 text-[10px] font-bold text-blue-800 dark:bg-zinc-950/50 dark:text-blue-400">
                                <Calendar className="h-3 w-3" />
                                Scheduled
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 rounded-md bg-zinc-100 px-2 py-0.5 text-[10px] font-bold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-400">
                                Ended
                              </span>
                            )}

                            {/* Timespan Tag */}
                            <span className="inline-flex items-center rounded-md bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                              {goal.timespan.charAt(0).toUpperCase() + goal.timespan.slice(1)}
                            </span>
                          </div>

                          <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400 flex items-center gap-1.5">
                            <Clock className="h-3 w-3 text-zinc-400" />
                            <span>{getTimespanDescription(goal)}</span>
                          </div>
                        </div>

                        {/* Card controls (Edit / Delete) */}
                        <div className="self-end sm:self-start flex items-center gap-1">
                          <button
                            onClick={() => handleStartEdit(goal)}
                            className="rounded-lg p-1.5 text-zinc-450 hover:bg-zinc-100 hover:text-blue-600 dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-blue-450 transition-colors cursor-pointer"
                            title="Edit Goal"
                            aria-label="Edit Goal"
                          >
                            <Edit2 className="h-3.8 w-3.8" />
                          </button>
                          <button
                            onClick={() => handleDeleteGoal(goal.id)}
                            className="rounded-lg p-1.5 text-zinc-450 hover:bg-zinc-100 hover:text-red-500 dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-red-400 transition-colors cursor-pointer"
                            title="Delete Goal"
                            aria-label="Delete Goal"
                          >
                            <Trash2 className="h-3.8 w-3.8" />
                          </button>
                        </div>
                      </div>

                      {/* Reps progress bar */}
                      <div className="mt-4">
                        <div className="flex items-center justify-between text-xs font-semibold">
                          <span className="text-zinc-650 dark:text-zinc-400">
                            Completed: <span className="text-zinc-900 dark:text-zinc-100">{goal.currentReps}</span> /{" "}
                            {goal.totalReps} reps
                          </span>
                          <span
                            className={
                              isCompleted
                                ? "text-emerald-600 dark:text-emerald-400"
                                : "text-zinc-900 dark:text-zinc-100"
                            }
                          >
                            {progressPercent}%
                          </span>
                        </div>
                        <div className="mt-1.5 h-2 w-full rounded-full bg-zinc-100 dark:bg-zinc-850 overflow-hidden">
                          <div
                            className={`h-full transition-all duration-300 ${
                              isCompleted ? "bg-emerald-500" : "bg-blue-600 dark:bg-blue-500"
                            }`}
                            style={{ width: `${progressPercent}%` }}
                          ></div>
                        </div>
                      </div>

                      {/* Calculations / Pace panel */}
                      <div className="mt-5 grid gap-4 rounded-lg bg-zinc-50/50 p-4 dark:bg-zinc-950/20 sm:grid-cols-2">
                        {/* Pace Display */}
                        <div className="flex flex-col justify-center">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                            Pacing Target Right Now
                          </span>
                          <span
                            className={`mt-1 text-2xl font-black tracking-tight tabular-nums ${
                              isCompleted
                                ? "text-emerald-600 dark:text-emerald-400"
                                : status === "ENDED"
                                  ? "text-zinc-400 dark:text-zinc-650"
                                  : "text-blue-600 dark:text-blue-500"
                            }`}
                          >
                            {isCompleted ? "0.0" : status === "ENDED" ? "—" : pace.toFixed(2)}
                          </span>
                          <span className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                            {isCompleted
                              ? "Goal Achieved!"
                              : status === "ENDED"
                                ? "Time window ended"
                                : formatPaceText(pace, goal.frequency)}
                          </span>
                        </div>

                        {/* Countdown / Time left display */}
                        <div className="flex flex-col justify-center sm:border-l sm:border-zinc-200/50 sm:pl-4 dark:sm:border-zinc-800/30">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                            {status === "PENDING" ? "Time Until Start" : "Time Remaining"}
                          </span>
                          <span className="mt-1 text-lg font-bold tabular-nums text-zinc-800 dark:text-zinc-200">
                            {status === "PENDING"
                              ? formatTimeSeconds(timeUntilStartSeconds)
                              : status === "ACTIVE" && !isCompleted
                                ? formatTimeSeconds(timeLeftSeconds)
                                : "00:00:00"}
                          </span>
                          <span className="text-xs text-zinc-500 dark:text-zinc-405 mt-0.5">
                            {status === "PENDING"
                              ? "Starts soon"
                              : status === "ACTIVE" && !isCompleted
                                ? "Continuous pacing update"
                                : status === "ENDED" && repsLeft > 0
                                  ? "Missed target by " + repsLeft + " reps"
                                  : "Goal period closed"}
                          </span>
                        </div>
                      </div>

                      {/* Rep increment controls */}
                      <div className="mt-5 flex items-center gap-2">
                        <button
                          onClick={() =>
                            handleIncrement(goal.id, parseInt(prompt("How many reps to add?", "1") || "1"))
                          }
                          disabled={isCompleted}
                          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-blue-600 py-2 text-sm font-semibold text-white shadow-xs transition-all hover:bg-blue-700 hover:shadow-md active:scale-[0.98] disabled:bg-zinc-100 disabled:text-zinc-400 disabled:shadow-none dark:bg-blue-500 dark:hover:bg-blue-600 dark:disabled:bg-zinc-800 dark:disabled:text-zinc-500 cursor-pointer"
                          aria-label="Increase Rep"
                        >
                          <Plus className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => handleIncrement(goal.id)}
                          disabled={isCompleted}
                          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-blue-600 py-2 text-sm font-semibold text-white shadow-xs transition-all hover:bg-blue-700 hover:shadow-md active:scale-[0.98] disabled:bg-zinc-100 disabled:text-zinc-400 disabled:shadow-none dark:bg-blue-500 dark:hover:bg-blue-600 dark:disabled:bg-zinc-800 dark:disabled:text-zinc-500 cursor-pointer"
                        >
                          <Plus className="h-4 w-4" />
                          +1 Rep
                        </button>
                        <button
                          onClick={() => handleDecrement(goal.id)}
                          disabled={goal.currentReps === 0}
                          className="rounded-lg border border-zinc-300 px-3.5 py-2 text-sm font-semibold text-zinc-700 hover:bg-zinc-50 active:scale-[0.98] disabled:border-zinc-200 disabled:text-zinc-355 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-850 dark:disabled:border-zinc-850 dark:disabled:text-zinc-650 cursor-pointer"
                          aria-label="Decrease Rep"
                        >
                          -1
                        </button>
                      </div>

                      {/* History Log Section */}
                      <div className="mt-4 border-t border-zinc-100 pt-3 dark:border-zinc-800/80">
                        <button
                          onClick={() => toggleHistory(goal.id)}
                          className="flex w-full items-center justify-between text-xs font-semibold text-zinc-505 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200 transition-colors cursor-pointer"
                        >
                          <span className="flex items-center gap-1.5">
                            <History className="h-3.5 w-3.5 text-zinc-450" />
                            Goal History Log ({goal.history.length})
                          </span>
                          {isHistoryOpen ? (
                            <ChevronUp className="h-4 w-4 text-zinc-400" />
                          ) : (
                            <ChevronDown className="h-4 w-4 text-zinc-400" />
                          )}
                        </button>

                        {isHistoryOpen && (
                          <div className="mt-3 space-y-2 max-h-48 overflow-y-auto pr-1">
                            {goal.history.length === 0 ? (
                              <p className="text-[11px] italic text-zinc-450 dark:text-zinc-500 py-1 pl-1">
                                No completed periods recorded yet.
                              </p>
                            ) : (
                              goal.history.map((entry) => (
                                <div
                                  key={entry.id}
                                  className="flex items-center justify-between rounded-lg border border-zinc-100 bg-zinc-50/50 p-2.5 text-[11px] dark:border-zinc-800/40 dark:bg-zinc-955/10"
                                >
                                  <div className="flex flex-col">
                                    <span className="font-semibold text-zinc-705 dark:text-zinc-300">
                                      {entry.periodStart} - {entry.periodEnd}
                                    </span>
                                    <span className="text-zinc-500 dark:text-zinc-500 mt-0.5">
                                      Reps completed: {entry.repsCompleted} / {entry.totalReps}
                                    </span>
                                  </div>

                                  <div>
                                    {entry.status === "COMPLETED" ? (
                                      <span className="inline-flex rounded-md bg-green-50 px-1.5 py-0.5 font-bold text-green-700 dark:bg-green-950/30 dark:text-green-400">
                                        Success
                                      </span>
                                    ) : entry.status === "PARTIAL" ? (
                                      <span className="inline-flex rounded-md bg-amber-50 px-1.5 py-0.5 font-bold text-amber-700 dark:bg-amber-950/30 dark:text-amber-400">
                                        Partial
                                      </span>
                                    ) : (
                                      <span className="inline-flex rounded-md bg-red-50 px-1.5 py-0.5 font-bold text-red-700 dark:bg-red-950/30 dark:text-red-400">
                                        Failed
                                      </span>
                                    )}
                                  </div>
                                </div>
                              ))
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
