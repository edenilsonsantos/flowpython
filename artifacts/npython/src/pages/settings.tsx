import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default function Settings() {
  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground mt-2">Manage your platform preferences.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Docker Environment</CardTitle>
          <CardDescription>
            Configure how workflows run in the Docker isolation environment.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="bg-secondary/50 p-4 rounded-md text-sm text-muted-foreground">
            Docker execution is managed automatically by the backend orchestrator. 
            Currently, workflows share the base environment.
          </div>
          <Button disabled>Restart Worker Engine</Button>
        </CardContent>
      </Card>
    </div>
  );
}
