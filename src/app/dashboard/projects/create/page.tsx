import { FeatureGate } from "@/components/ui/feature-gate";
import CreateProjectForm from "./CreateProjectForm";

// Gated like the projects list (route inventory F-2).
export default function CreateProjectPage() {
  return (
    <FeatureGate featureKey="projects">
      <CreateProjectForm />
    </FeatureGate>
  );
}
