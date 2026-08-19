import { DraftAssistant } from "@/components/draft-assistant";
import { DemoLobby } from "./lobby";

export default async function DemoPage({
  searchParams,
}: {
  searchParams: Promise<{ room?: string }>;
}) {
  const { room } = await searchParams;
  return room ? <DraftAssistant variant="demo" /> : <DemoLobby />;
}
