import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { Layout } from "@/components/layout";

import Dashboard from "@/pages/dashboard";
import Workflows from "@/pages/workflows";
import WorkflowEditor from "@/pages/workflow-editor";
import Executions from "@/pages/executions";
import ExecutionDetail from "@/pages/execution-detail";
import Variables from "@/pages/variables";
import Credentials from "@/pages/credentials";
import Settings from "@/pages/settings";

const queryClient = new QueryClient();

function Router() {
  return (
    <Layout>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/workflows" component={Workflows} />
        <Route path="/workflows/:id/edit" component={WorkflowEditor} />
        <Route path="/executions" component={Executions} />
        <Route path="/executions/:id" component={ExecutionDetail} />
        <Route path="/variables" component={Variables} />
        <Route path="/credentials" component={Credentials} />
        <Route path="/settings" component={Settings} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
