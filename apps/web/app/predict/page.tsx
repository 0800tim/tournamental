/**
 * /predict — alias for /world-cup-2026 to back the bottom-nav "Predict"
 * tab when we add more tournaments. Today it just redirects.
 */

import { redirect } from "next/navigation";

export default function PredictPage() {
  redirect("/world-cup-2026");
}
