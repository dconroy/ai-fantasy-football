import type { Metadata } from "next";
import { WeeklyHq } from "@/components/weekly-hq";

export const metadata: Metadata = {
  title: "Weekly HQ · Conroy's AI Draft Dojo",
};

export default function WeeklyPage() {
  return <WeeklyHq />;
}
