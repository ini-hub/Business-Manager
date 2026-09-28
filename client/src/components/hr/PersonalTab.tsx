import { DynamicFieldForm } from "./DynamicFieldForm";

export function PersonalTab({ staffId, basePath = "/api/hr" }: { staffId: string; basePath?: "/api/hr" | "/api/profile-completion" }) {
  return <DynamicFieldForm staffId={staffId} section="personal" basePath={basePath} />;
}
