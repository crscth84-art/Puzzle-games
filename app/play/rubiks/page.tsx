import RubiksGame from "@/components/RubiksGame";
import { requirePageSession } from "@/lib/page-session";
import { MAX_HINTS } from "@/lib/rubiks";

export default async function RubiksPage() {
  await requirePageSession();
  return <RubiksGame maxHints={MAX_HINTS} />;
}
