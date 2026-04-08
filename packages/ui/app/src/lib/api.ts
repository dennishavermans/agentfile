export type AgentStatus = {
  name: string;
  outputPath: string;
  synced: boolean;
  lastSynced: number;
  stale: boolean;
  disabled: boolean;
};

export type StatusResponse = {
  missingContract?: boolean;
  message?: string;
  agents: AgentStatus[];
};

export type ContractResponse = {
  version: number;
  project: {
    name: string;
    stack: string[];
  };
  rules: {
    coding: string[];
    architecture: string[];
    testing: string[];
    naming: string[];
  };
  skills: Array<{
    name: string;
    description: string;
    context?: string[];
    steps: string[];
    expected_output?: string;
  }>;
};

export async function getStatus(): Promise<StatusResponse> {
  const response = await fetch("/api/status");
  return response.json() as Promise<StatusResponse>;
}

export async function getContract(): Promise<ContractResponse> {
  const response = await fetch("/api/contract");
  if (!response.ok) {
    throw new Error("Unable to load contract");
  }
  return response.json() as Promise<ContractResponse>;
}

export async function validateContract(): Promise<void> {
  const response = await fetch("/api/contract");
  if (!response.ok) {
    throw new Error("Validation failed");
  }
}

export async function getPreview(agent: string): Promise<{ content: string; outputPath: string }> {
  const response = await fetch(`/api/preview/${agent}`);
  if (!response.ok) {
    throw new Error("Unable to load preview");
  }
  return response.json() as Promise<{ content: string; outputPath: string }>;
}

export async function getDiff(agent: string): Promise<{ diff: string; outputPath: string }> {
  const response = await fetch(`/api/diff/${agent}`);
  if (!response.ok) {
    throw new Error("Unable to load diff");
  }
  return response.json() as Promise<{ diff: string; outputPath: string }>;
}

export async function patchRules(rules: ContractResponse["rules"]): Promise<void> {
  const response = await fetch("/api/contract", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rules }),
  });

  if (!response.ok) {
    const payload = (await response.json()) as { message?: string };
    throw new Error(payload.message ?? "Failed to update rules");
  }
}

export async function syncAll(onMessage: (line: unknown) => void): Promise<void> {
  const response = await fetch("/api/sync", { method: "POST" });
  if (!response.body) {
    throw new Error("No sync stream available");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim()) {
        continue;
      }
      onMessage(JSON.parse(line) as unknown);
    }
  }
}
