import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { getStatus } from "../api.ts";

const duration = (seconds: number) => {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours) return `${hours} h ${minutes} min`;
  return minutes ? `${minutes} min` : `${seconds} s`;
};

/** The running system, live: refreshes every 5 seconds and remembers who answered. */
export function StatusPage() {
  const status = useQuery({
    queryKey: ["status"],
    queryFn: getStatus,
    refetchInterval: 5000,
  });
  // The last 10 answers, newest first. Updated while rendering when a new answer arrives
  // (React's pattern for state that follows other state), so the list never lags a render.
  const [answers, setAnswers] = useState<{ replica: string; at: number }[]>([]);
  const [lastAnswer, setLastAnswer] = useState(0);
  if (status.data && status.dataUpdatedAt !== lastAnswer) {
    setLastAnswer(status.dataUpdatedAt);
    setAnswers((previous) =>
      [
        { replica: status.data.replica, at: status.dataUpdatedAt },
        ...previous,
      ].slice(0, 10),
    );
  }
  const data = status.data;

  return (
    <main className="page narrow">
      <h1>Status</h1>
      <p>This copy of the server, live. It refreshes every 5 seconds.</p>
      {status.isError && <p role="alert">{status.error.message}</p>}
      {data && (
        <dl className="facts">
          <dt>Version</dt>
          <dd>{data.version}</dd>
          <dt>Answered by</dt>
          <dd>{data.replica}</dd>
          <dt>Up for</dt>
          <dd>{duration(data.uptime_seconds)}</dd>
          <dt>Database</dt>
          <dd>
            {data.database.ok
              ? `OK, ${data.database.latency_ms} ms`
              : "Unreachable"}
          </dd>
          <dt>AI suggestions</dt>
          <dd>{data.ai_enabled ? "On" : "Off: no key"}</dd>
        </dl>
      )}
      <button
        type="button"
        className="secondary"
        onClick={() => status.refetch()}
      >
        Refresh now
      </button>
      <h2>Replicas that answered</h2>
      <p className="how">
        In the cloud, several copies run behind a load balancer; this list shows
        which one answered each refresh.
      </p>
      <ol className="replicas" aria-label="Replicas that answered">
        {answers.map((answer) => (
          <li key={answer.at}>
            <span>{answer.replica}</span>{" "}
            <time dateTime={new Date(answer.at).toISOString()}>
              {new Date(answer.at).toLocaleTimeString()}
            </time>
          </li>
        ))}
      </ol>
      <h2>The API</h2>
      <p className="how">
        Every endpoint, with its fields and error codes, generated from the code
        (OpenAPI). You can call them from the page.
      </p>
      {/* A plain link, not the router's: /docs is served by FastAPI, not by this app. */}
      <a href="/docs" target="_blank" rel="noreferrer">
        Open the interactive API docs
      </a>
    </main>
  );
}
