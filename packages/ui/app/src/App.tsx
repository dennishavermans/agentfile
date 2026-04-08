import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import hljs from "highlight.js/lib/core";
import markdown from "highlight.js/lib/languages/markdown";
import {
  AlertTriangle,
  CheckCircle2,
  FileCode2,
  FolderCog,
  Layers3,
  Moon,
  RefreshCcw,
  Sparkles,
  Sun,
  TerminalSquare,
} from "lucide-react";
import { useMemo, useState } from "react";

import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./components/ui/card";
import { Separator } from "./components/ui/separator";
import { useTheme } from "./hooks/useTheme";
import {
  type ContractResponse,
  getContract,
  getDiff,
  getPreview,
  getStatus,
  patchRules,
  syncAll,
  validateContract,
} from "./lib/api";
import { cn } from "./lib/utils";

hljs.registerLanguage("markdown", markdown);

type RuleCategory = keyof ContractResponse["rules"];

const categories: RuleCategory[] = [
  "coding",
  "architecture",
  "testing",
  "naming",
];

const formatTime = (value: number): string => {
  if (!value) {
    return "never";
  }

  return new Date(value).toLocaleString();
};

const highlightMarkdown = (text: string): string =>
  hljs.highlight(text, { language: "markdown" }).value;

const metricCardClassName =
  "border-border/80 bg-card/80 backdrop-blur-sm shadow-[0_1px_0_rgba(255,255,255,0.03)]";

function SortableRule({ id, text }: { id: string; text: string }) {
  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({ id });

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className="rounded-lg border border-border bg-background/60 px-3 py-3 text-sm text-foreground shadow-sm"
      {...attributes}
      {...listeners}
    >
      {text}
    </li>
  );
}

function StatusPill({
  stale,
  disabled,
}: {
  stale: boolean;
  disabled: boolean;
}) {
  if (disabled) {
    return <Badge variant="muted">disabled</Badge>;
  }

  if (stale) {
    return <Badge variant="warning">stale</Badge>;
  }

  return <Badge variant="success">synced</Badge>;
}

export const App = () => {
  const queryClient = useQueryClient();
  const { theme, toggleTheme } = useTheme();
  const [selectedAgent, setSelectedAgent] = useState<string>("");
  const [syncLog, setSyncLog] = useState<string[]>([]);

  const statusQuery = useQuery({
    queryKey: ["status"],
    queryFn: getStatus,
    refetchInterval: 5000,
  });
  const contractQuery = useQuery({
    queryKey: ["contract"],
    queryFn: getContract,
    retry: false,
  });
  const previewQuery = useQuery({
    queryKey: ["preview", selectedAgent],
    queryFn: () => getPreview(selectedAgent),
    enabled: Boolean(selectedAgent),
  });
  const diffQuery = useQuery({
    queryKey: ["diff", selectedAgent],
    queryFn: () => getDiff(selectedAgent),
    enabled: Boolean(selectedAgent),
  });

  const syncMutation = useMutation({
    mutationFn: async () => {
      setSyncLog([]);
      await syncAll((line) => {
        setSyncLog((prev) => [...prev, JSON.stringify(line)]);
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["status"] });
      await queryClient.invalidateQueries({ queryKey: ["contract"] });

      if (selectedAgent) {
        await queryClient.invalidateQueries({
          queryKey: ["preview", selectedAgent],
        });
        await queryClient.invalidateQueries({
          queryKey: ["diff", selectedAgent],
        });
      }
    },
  });

  const validateMutation = useMutation({ mutationFn: validateContract });

  const patchRulesMutation = useMutation({
    mutationFn: patchRules,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["contract"] });
    },
  });

  const sensors = useSensors(useSensor(PointerSensor));

  const reorderRules = (category: RuleCategory, event: DragEndEvent) => {
    if (
      !contractQuery.data ||
      !event.over ||
      event.active.id === event.over.id
    ) {
      return;
    }

    const current = contractQuery.data.rules[category];
    const oldIndex = current.findIndex(
      (rule) => `${category}:${rule}` === event.active.id,
    );
    const newIndex = current.findIndex(
      (rule) => `${category}:${rule}` === event.over?.id,
    );

    if (oldIndex < 0 || newIndex < 0) {
      return;
    }

    const next = arrayMove(current, oldIndex, newIndex);
    const nextRules = {
      ...contractQuery.data.rules,
      [category]: next,
    };

    queryClient.setQueryData(["contract"], {
      ...contractQuery.data,
      rules: nextRules,
    });
    patchRulesMutation.mutate(nextRules);
  };

  const rows = statusQuery.data?.agents ?? [];

  const stats = useMemo(() => {
    const active = rows.filter((item) => !item.disabled).length;
    const stale = rows.filter((item) => item.stale).length;
    const lastSync = Math.max(...rows.map((item) => item.lastSynced), 0);
    const ruleCount = contractQuery.data
      ? categories.reduce(
          (sum, key) => sum + contractQuery.data.rules[key].length,
          0,
        )
      : 0;

    return {
      total: rows.length,
      active,
      stale,
      lastSync,
      ruleCount,
      skills: contractQuery.data?.skills.length ?? 0,
    };
  }, [contractQuery.data, rows]);

  if (statusQuery.data?.missingContract) {
    return (
      <main className="min-h-screen bg-[radial-gradient(circle_at_top,#0f172a_0%,#09090b_45%,#020617_100%)] px-6 py-10 text-foreground">
        <div className="mx-auto max-w-5xl">
          <Card className="overflow-hidden border-border/80 bg-card/80 backdrop-blur">
            <CardHeader className="border-b border-border/70 bg-muted/30">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="rounded-xl border border-border bg-background/80 p-3">
                    <FolderCog className="h-6 w-6 text-primary" />
                  </div>
                  <div>
                    <CardTitle className="text-2xl">
                      agentfile dashboard
                    </CardTitle>
                    <CardDescription>
                      No contract found for this project root yet.
                    </CardDescription>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => toggleTheme()}
                  title={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
                >
                  {theme === "dark" ? (
                    <Sun className="h-4 w-4" />
                  ) : (
                    <Moon className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </CardHeader>
            <CardContent className="grid gap-6 p-6 md:grid-cols-[1.3fr_0.7fr]">
              <div className="space-y-3">
                <h2 className="text-lg font-semibold">What this means</h2>
                <p className="text-sm text-muted-foreground">
                  The web UI is running correctly, but the selected project does
                  not contain an
                  <code className="mx-1 rounded bg-muted px-1.5 py-0.5 text-xs">
                    ai/contract.yaml
                  </code>
                  file yet.
                </p>
                <div className="rounded-lg border border-border bg-background/60 p-4 text-sm text-muted-foreground">
                  Run{" "}
                  <span className="font-medium text-foreground">
                    agentfile init
                  </span>{" "}
                  for a new project or{" "}
                  <span className="font-medium text-foreground">
                    agentfile migrate
                  </span>{" "}
                  to import existing instructions.
                </div>
              </div>
              <div className="rounded-xl border border-primary/20 bg-primary/5 p-5">
                <div className="mb-3 flex items-center gap-2 text-sm font-medium text-primary">
                  <Sparkles className="h-4 w-4" />
                  Suggested next step
                </div>
                <pre className="overflow-auto rounded-lg bg-background/80 p-4 text-xs text-foreground">
                  {`npm run ui:migrate-case\nnode ../../packages/cli/dist/bin.js migrate --from AGENTS.md`}
                </pre>
              </div>
            </CardContent>
          </Card>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,#111827_0%,#09090b_42%,#020617_100%)] px-6 py-8 text-foreground">
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <Card className="overflow-hidden border-border/80 bg-card/80 backdrop-blur">
          <CardHeader className="flex flex-col gap-4 border-b border-border/70 bg-muted/20 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">
                <Sparkles className="h-3.5 w-3.5" />
                agent orchestration
              </div>
              <CardTitle className="text-3xl">
                {contractQuery.data?.project.name ?? "agentfile dashboard"}
              </CardTitle>
              <CardDescription>
                Inspect generated agent outputs, validate the contract, and sync
                changes across tools.
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button
                variant="outline"
                onClick={() => validateMutation.mutate()}
              >
                <CheckCircle2 className="h-4 w-4" />
                Validate
              </Button>
              <Button
                onClick={() => syncMutation.mutate()}
                disabled={syncMutation.isPending}
              >
                <RefreshCcw
                  className={cn(
                    "h-4 w-4",
                    syncMutation.isPending && "animate-spin",
                  )}
                />
                {syncMutation.isPending ? "Syncing" : "Sync all"}
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={() => toggleTheme()}
                title={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
              >
                {theme === "dark" ? (
                  <Sun className="h-4 w-4" />
                ) : (
                  <Moon className="h-4 w-4" />
                )}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="grid gap-4 p-6 md:grid-cols-2 xl:grid-cols-5">
            <Card className={metricCardClassName}>
              <CardContent className="p-5">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Active agents
                </p>
                <p className="mt-2 text-3xl font-semibold">
                  {stats.active}
                  <span className="ml-1 text-base text-muted-foreground">
                    / {stats.total}
                  </span>
                </p>
              </CardContent>
            </Card>
            <Card className={metricCardClassName}>
              <CardContent className="p-5">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Rule count
                </p>
                <p className="mt-2 text-3xl font-semibold">{stats.ruleCount}</p>
              </CardContent>
            </Card>
            <Card className={metricCardClassName}>
              <CardContent className="p-5">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Skills
                </p>
                <p className="mt-2 text-3xl font-semibold">{stats.skills}</p>
              </CardContent>
            </Card>
            <Card className={metricCardClassName}>
              <CardContent className="p-5">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Last sync
                </p>
                <p className="mt-2 text-sm font-medium text-foreground">
                  {formatTime(stats.lastSync)}
                </p>
              </CardContent>
            </Card>
            <Card className={metricCardClassName}>
              <CardContent className="p-5">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Stale outputs
                </p>
                <p className="mt-2 text-3xl font-semibold text-amber-300">
                  {stats.stale}
                </p>
              </CardContent>
            </Card>
          </CardContent>
        </Card>

        <section className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
          <div className="flex flex-col gap-6">
            <Card className="border-border/80 bg-card/80 backdrop-blur">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Layers3 className="h-5 w-5 text-primary" />
                  Agent status
                </CardTitle>
                <CardDescription>
                  Select an agent to inspect the generated file preview.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="max-h-[460px] space-y-2 overflow-auto pr-1">
                  {rows.map((item) => {
                    const selected = selectedAgent === item.name;
                    return (
                      <button
                        type="button"
                        key={item.name}
                        className={cn(
                          "w-full rounded-xl border p-4 text-left transition-colors",
                          selected
                            ? "border-primary bg-primary/10"
                            : "border-border bg-background/50 hover:bg-accent/40",
                        )}
                        onClick={() => setSelectedAgent(item.name)}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="flex items-center gap-2">
                              <span
                                className={cn(
                                  "inline-block h-2.5 w-2.5 rounded-full",
                                  item.disabled
                                    ? "bg-muted-foreground"
                                    : item.stale
                                      ? "bg-amber-400"
                                      : "bg-emerald-400",
                                )}
                              />
                              <span className="font-medium">{item.name}</span>
                            </div>
                            <p className="mt-2 text-xs text-muted-foreground">
                              {item.outputPath}
                            </p>
                          </div>
                          <StatusPill
                            stale={item.stale}
                            disabled={item.disabled}
                          />
                        </div>
                        <p className="mt-3 text-xs text-muted-foreground">
                          Last synced: {formatTime(item.lastSynced)}
                        </p>
                      </button>
                    );
                  })}
                </div>
                <Separator />
                <div className="space-y-2 rounded-xl border border-border bg-background/50 p-4">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <TerminalSquare className="h-4 w-4 text-primary" />
                    Sync stream
                  </div>
                  <div className="max-h-40 space-y-1 overflow-auto text-xs text-muted-foreground">
                    {syncLog.length ? (
                      syncLog.map((line, index) => (
                        // biome-ignore lint/suspicious/noArrayIndexKey: sync log lines are display-only and order matters
                        <p key={`${line}-${index}`}>{line}</p>
                      ))
                    ) : (
                      <p>Run sync to stream generated files and errors here.</p>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-border/80 bg-card/80 backdrop-blur">
              <CardHeader>
                <CardTitle className="text-lg">Skills</CardTitle>
                <CardDescription>
                  Shared workflows embedded in the contract.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {contractQuery.data?.skills.map((skill) => (
                  <div
                    key={skill.name}
                    className="rounded-xl border border-border bg-background/50 p-4"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-medium">{skill.name}</p>
                      <Badge variant="outline">
                        {skill.steps.length} steps
                      </Badge>
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground">
                      {skill.description}
                    </p>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

          <div className="flex flex-col gap-6">
            <Card className="border-border/80 bg-card/80 backdrop-blur">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <FileCode2 className="h-5 w-5 text-primary" />
                  Generated file preview
                </CardTitle>
                <CardDescription>
                  {selectedAgent
                    ? (previewQuery.data?.outputPath ??
                      "Loading generated output...")
                    : "Select an agent to preview generated content."}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {selectedAgent ? (
                  <>
                    <pre className="max-h-[360px] overflow-auto rounded-xl border border-border bg-black/40 p-4 text-xs leading-6 shadow-inner">
                      <code
                        // biome-ignore lint/security/noDangerouslySetInnerHtml: intentional — highlight.js generates safe sanitized HTML
                        dangerouslySetInnerHTML={{
                          __html: highlightMarkdown(
                            previewQuery.data?.content ?? "",
                          ),
                        }}
                      />
                    </pre>
                    {rows.find((item) => item.name === selectedAgent)?.stale ? (
                      <div className="space-y-3 rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
                        <div className="flex items-center gap-2 text-sm font-medium text-amber-300">
                          <AlertTriangle className="h-4 w-4" />
                          Unified diff
                        </div>
                        <pre className="max-h-[260px] overflow-auto rounded-lg bg-black/40 p-4 text-xs">
                          {(diffQuery.data?.diff ?? "")
                            .split("\n")
                            .map((line, index) => {
                              const className = line.startsWith("+")
                                ? "text-emerald-300"
                                : line.startsWith("-")
                                  ? "text-red-300"
                                  : "text-muted-foreground";

                              return (
                                // biome-ignore lint/suspicious/noArrayIndexKey: diff lines are display-only, index is the correct stable key
                                <span
                                  // biome-ignore lint/suspicious/noArrayIndexKey: diff lines are display-only, index is the correct stable key
                                  key={`${line}-${index}`}
                                  className={`block ${className}`}
                                >
                                  {line}
                                </span>
                              );
                            })}
                        </pre>
                      </div>
                    ) : null}
                  </>
                ) : (
                  <div className="rounded-xl border border-dashed border-border bg-background/40 p-10 text-center text-sm text-muted-foreground">
                    Choose an agent on the left to inspect the generated output
                    and stale diff.
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="border-border/80 bg-card/80 backdrop-blur">
              <CardHeader>
                <CardTitle className="text-lg">Contract rules</CardTitle>
                <CardDescription>
                  Reorder rules by drag and drop. Changes persist immediately.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-6 lg:grid-cols-2">
                {contractQuery.data ? (
                  categories.map((category) => {
                    const items = contractQuery.data.rules[category];

                    return (
                      <div
                        key={category}
                        className="space-y-3 rounded-xl border border-border bg-background/50 p-4"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-sm font-medium capitalize">
                            {category}
                          </p>
                          <Badge variant="outline">{items.length}</Badge>
                        </div>
                        <DndContext
                          sensors={sensors}
                          collisionDetection={closestCenter}
                          onDragEnd={(event) => reorderRules(category, event)}
                        >
                          <SortableContext
                            items={items.map((item) => `${category}:${item}`)}
                            strategy={verticalListSortingStrategy}
                          >
                            <ul className="space-y-2">
                              {items.map((rule) => (
                                <SortableRule
                                  key={`${category}:${rule}`}
                                  id={`${category}:${rule}`}
                                  text={rule}
                                />
                              ))}
                            </ul>
                          </SortableContext>
                        </DndContext>
                      </div>
                    );
                  })
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Loading rules…
                  </p>
                )}
              </CardContent>
            </Card>

            {validateMutation.isSuccess || validateMutation.isError ? (
              <Card
                className={cn(
                  "border-border/80",
                  validateMutation.isSuccess
                    ? "bg-emerald-500/10"
                    : "bg-destructive/10",
                )}
              >
                <CardContent className="flex items-center gap-3 p-4 text-sm">
                  {validateMutation.isSuccess ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-300" />
                  ) : (
                    <AlertTriangle className="h-4 w-4 text-destructive" />
                  )}
                  <span>
                    {validateMutation.isSuccess
                      ? "Validation succeeded."
                      : "Validation failed."}
                  </span>
                </CardContent>
              </Card>
            ) : null}
          </div>
        </section>
      </div>
    </main>
  );
};
